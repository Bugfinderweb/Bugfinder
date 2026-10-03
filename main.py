# ============================================================
# CodeBugFinder — main.py  (Groq-only build)
# Flask app + all routes
# ============================================================

import json
import time
from flask import Flask, request, jsonify, send_from_directory, render_template

from services import (
    # DB
    init_db, get_db,
    # Key (for health endpoint)
    GROQ_KEY,
    # Prompts / constants
    BUGFINDER_PREFIX, CODE_EXT_LANG,
    # Groq provider
    call_groq,
    # Boot log
    boot_log,
)

# ------------------------------------------------------------
# APP INIT
# ------------------------------------------------------------
app = Flask(__name__)
init_db()
boot_log()


# ============================================================
# AUTH ROUTES
# ============================================================
@app.route("/api/register", methods=["POST"])
def register():
    data = request.json
    username = data.get("username", "").strip()
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "INSERT INTO users (username, pin_hash, real_name, pet_pref, age) VALUES (?, ?, ?, ?, ?)",
            (username, data.get("pin_hash"), data.get("real_name"),
             data.get("pet_pref"), data.get("age"))
        )
        conn.commit()
        conn.close()
        return jsonify({"status": "success"})
    except Exception as e:
        import sqlite3
        if isinstance(e, sqlite3.IntegrityError):
            return jsonify({"error": "Username already exists. Please log in."}), 409
        return jsonify({"error": str(e)}), 500


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username", "").strip()
    pin_hash = data.get("pin_hash", "").strip()
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT pin_hash FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()
    if row and row[0] == pin_hash:
        return jsonify({"status": "success"})
    return jsonify({"error": "Incorrect username or PIN"}), 401


@app.route("/api/reset-pin", methods=["POST"])
def reset_pin():
    data = request.json
    username = data.get("username", "").strip()
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT real_name, pet_pref, age FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "User not found"}), 404
    if (row[0] != data.get("real_name")
            or row[1] != data.get("pet_pref")
            or row[2] != data.get("age")):
        conn.close()
        return jsonify({"error": "Security answers are incorrect"}), 401
    c.execute("UPDATE users SET pin_hash = ? WHERE username = ?",
              (data.get("new_pin_hash"), username))
    conn.commit()
    conn.close()
    return jsonify({"status": "success"})


# ============================================================
# CHAT STORAGE ROUTES
# ============================================================
@app.route("/api/chats/<username>", methods=["GET"])
def get_chats(username):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT chat_id, title, timestamp, messages FROM chats WHERE username = ?",
              (username,))
    rows = c.fetchall()
    conn.close()
    chats = {}
    for row in rows:
        chats[row[0]] = {
            "id": row[0],
            "title": row[1],
            "timestamp": row[2],
            "messages": json.loads(row[3]),
        }
    return jsonify(chats)


@app.route("/api/chats/<username>", methods=["POST"])
def save_chat(username):
    data = request.json
    chat = data.get("chat")
    if not chat:
        return jsonify({"error": "No chat provided"}), 400
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT OR REPLACE INTO chats (username, chat_id, title, timestamp, messages) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, chat["id"], chat["title"], chat["timestamp"],
         json.dumps(chat["messages"]))
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "saved"})


@app.route("/api/chats/<username>/<chat_id>", methods=["DELETE"])
def delete_chat(username, chat_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM chats WHERE username = ? AND chat_id = ?", (username, chat_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})


# ============================================================
# STATIC + TEMPLATE ROUTES
# ============================================================
@app.route("/")
def index():               return render_template("base.html")
@app.route("/base.css")
def base_css():            return send_from_directory(".", "base.css")
@app.route("/components.css")
def components_css():      return send_from_directory(".", "components.css")
@app.route("/core.js")
def core_js():             return send_from_directory(".", "core.js")
@app.route("/app.js")
def app_js():              return send_from_directory(".", "app.js")
@app.route("/manifest.json")
def manifest():            return send_from_directory(".", "manifest.json")
@app.route("/service-worker.js")
def sw():                  return send_from_directory(".", "service-worker.js")
@app.route("/icon-512.png")
def icon():                return send_from_directory(".", "icon-512.png")


# ============================================================
# MAIN CHAT ROUTE  (Groq-only)
# ============================================================
@app.route("/api/chat", methods=["POST"])
def chat_endpoint():
    try:
        body = request.get_json() or {}
        user_message = (body.get("message") or "").strip()
        history = body.get("history", [])
        modes = body.get("mode", {
            "think": False, "search": False,
            "image": False, "bugfinder": False,
        })
        attached_file = body.get("attached_file")

        if not user_message and not attached_file:
            return jsonify({"error": "Empty message"}), 400

        # ----------------------------------------------------
        # DISABLED MODES → return a friendly reply, don't crash
        # ----------------------------------------------------
        if modes.get("image"):
            return jsonify({
                "reply": (
                    "🛑 **Image mode is disabled** in this build. "
                    "This version only talks to Groq (text-only). "
                    "Toggle Image off and send your message again."
                )
            })

        if modes.get("search"):
            return jsonify({
                "reply": (
                    "🛑 **Search mode is disabled** in this build. "
                    "Web search providers were removed to keep the app Groq-only. "
                    "Toggle Search off and send your message again."
                )
            })

        # ----------------------------------------------------
        # 1. FILE ATTACHMENT HANDLING (text/code only)
        # ----------------------------------------------------
        file_block = ""
        if attached_file:
            file_type = attached_file.get("type")
            file_data = attached_file.get("data")
            file_name = (attached_file.get("name") or "attachment").strip()

            if file_type == "image":
                return jsonify({
                    "reply": (
                        "🛑 **Image analysis is disabled** in this build. "
                        "Vision required Gemini, which was removed. "
                        "Attach a text/code file instead."
                    )
                })

            if file_type == "text":
                ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
                lang = CODE_EXT_LANG.get(ext, "")
                code = (file_data or "")[:15000]

                if lang:
                    file_block = (
                        f"File: {file_name}\n\n"
                        f"```{lang}\n{code}\n```\n\n"
                        f"Find all bugs in this code."
                    )
                else:
                    file_block = (
                        f"File: {file_name}\n\n"
                        f"```\n{code}\n```\n\n"
                        f"Read the file and answer."
                    )

        # ----------------------------------------------------
        # 2. BUILD THE FINAL PROMPT
        # ----------------------------------------------------
        final_prompt = user_message or ""

        if file_block:
            if final_prompt:
                final_prompt = f"{file_block}\n\nAdditional user question: {final_prompt}"
            else:
                final_prompt = file_block

        if modes.get("bugfinder"):
            final_prompt = BUGFINDER_PREFIX + final_prompt

        if modes.get("think"):
            final_prompt = (
                "Think step-by-step and deeply before answering.\n\n"
                f"User Question: {final_prompt}"
            )

        # ----------------------------------------------------
        # 3. CALL GROQ
        # ----------------------------------------------------
        start_time = time.time()
        reply = call_groq(final_prompt, history)
        thought_time = round(time.time() - start_time, 1) if modes.get("think") else None

        if not reply:
            return jsonify({
                "error": "Groq did not return a response. Check GROQ_KEY and try again."
            }), 502

        return jsonify({"reply": reply, "thought_time": thought_time})

    except Exception as e:
        print(f"[Chat Error] {e}")
        return jsonify({"error": str(e)}), 500


# ============================================================
# HEALTH CHECK
# ============================================================
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "provider": "groq",
        "groq_key": bool(GROQ_KEY),
    })


# ============================================================
# RUN
# ============================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)