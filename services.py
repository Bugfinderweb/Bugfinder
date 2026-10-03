# ============================================================
# CodeBugFinder — services.py  (Groq-only build)
# Config • DB • Groq provider • Prompts • Constants
# ============================================================

import os
import sqlite3
import httpx
from dotenv import load_dotenv

load_dotenv()

# ------------------------------------------------------------
# DATABASE
# ------------------------------------------------------------
DB_PATH = os.path.join(os.path.expanduser('~'), 'chatlegend_v2.db')


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (username TEXT PRIMARY KEY, pin_hash TEXT, real_name TEXT, pet_pref TEXT, age TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS chats
                 (username TEXT, chat_id TEXT, title TEXT, timestamp INTEGER, messages TEXT,
                  PRIMARY KEY (username, chat_id))''')
    conn.commit()
    conn.close()


def get_db():
    """Return a fresh sqlite connection."""
    return sqlite3.connect(DB_PATH)


# ------------------------------------------------------------
# API KEY  (only one)
# ------------------------------------------------------------
GROQ_KEY = os.getenv("GROQ_KEY")

# ------------------------------------------------------------
# MODEL / TOKENS
# ------------------------------------------------------------
GROQ_MODEL = "openai/gpt-oss-20b"
MAX_TOKENS = 4000
REQUEST_TIMEOUT = 90.0


# ------------------------------------------------------------
# PERSONA  (unchanged)
# ------------------------------------------------------------
SYSTEM_PROMPT = (
    "You are CodeBugFinder, a world-class programming expert. "
    "Your sole purpose is to analyze code, find bugs, explain them clearly, "
    "and provide corrected code. When given code, first understand its intent, "
    "then list all bugs (logic errors, syntax errors, edge cases, security issues, "
    "performance problems). For each bug, explain why it's a bug and show the fix. "
    "Be concise but thorough. Always format code in markdown code blocks with the correct language."
)

BUGFINDER_PREFIX = (
    "Analyze the following code for bugs. List every bug you find, "
    "explain why it's a bug, and provide the corrected code.\n\n"
)

# File-extension → markdown code fence language
CODE_EXT_LANG = {
    "py": "python", "pyw": "python",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript",
    "ts": "typescript", "tsx": "tsx", "jsx": "jsx",
    "html": "html", "htm": "html", "xhtml": "html",
    "css": "css", "scss": "scss", "sass": "scss", "less": "less",
    "java": "java", "kt": "kotlin", "kts": "kotlin",
    "c": "c", "h": "c",
    "cpp": "cpp", "cc": "cpp", "cxx": "cpp", "hpp": "cpp", "hh": "cpp",
    "cs": "csharp", "go": "go", "rs": "rust", "rb": "ruby", "php": "php",
    "swift": "swift", "m": "objectivec", "mm": "objectivec",
    "sh": "bash", "bash": "bash", "zsh": "bash", "ps1": "powershell",
    "sql": "sql", "json": "json", "xml": "xml",
    "yml": "yaml", "yaml": "yaml", "toml": "toml", "ini": "ini",
    "md": "markdown", "r": "r", "lua": "lua", "pl": "perl", "dart": "dart",
    "vue": "html", "svelte": "html",
}


# ============================================================
# GROQ  (single call path)
# ============================================================
def call_groq(prompt, history=None):
    """Send a prompt to Groq. Returns the assistant's text or None on failure."""
    if not GROQ_KEY:
        print("[Groq] SKIPPED - GROQ_KEY missing")
        return None

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in (history or [])[-6:]:
        role = h.get("role")
        content = h.get("content")
        if role and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            res = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": MAX_TOKENS,
                },
            )
            if res.status_code == 200:
                return res.json()["choices"][0]["message"]["content"].strip()

            if res.status_code == 401:
                print("[Groq] Auth error — GROQ_KEY is invalid")
            elif res.status_code == 429:
                print("[Groq] Rate-limited (429)")
            else:
                print(f"[Groq] HTTP {res.status_code}: {res.text[:200]}")
    except Exception as e:
        print(f"[Groq Exception] {type(e).__name__}: {e}")

    return None


# ------------------------------------------------------------
# BOOT LOG
# ------------------------------------------------------------
def boot_log():
    print(f"[BOOT] Groq key loaded: {'YES' if GROQ_KEY else 'NO'}")