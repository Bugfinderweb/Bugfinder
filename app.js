// ============================================================
// CodeBugFinder — app.js
// Chats • Messages • Composer • Attachments • Markdown • Boot
// Depends on window.CL from core.js
// ============================================================

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  if (!window.CL) {
    console.error('[app.js] core.js must be loaded first.');
    return;
  }

  // ============================================================
  // MARKDOWN + SYNTAX HIGHLIGHTING
  // ============================================================
  if (window.marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function renderMarkdown(text) {
    try {
      const raw = (typeof marked.parse === 'function')
        ? marked.parse(text, { breaks: true })
        : marked(text);
      return DOMPurify.sanitize(raw);
    } catch (e) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  function highlightCodeBlocks(container) {
    if (typeof window.hljs === 'undefined') return;
    container.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block); } catch (e) { /* ignore */ }
    });
  }

  // ============================================================
  // CHAT STATE + HISTORY LIST
  // ============================================================
  const welcomeScreen = $('welcomeScreen');
  const chatArea      = $('chatArea');
  const chatMessages  = $('chatMessages');
  const historyList   = $('historyList');
  const searchChats   = $('searchChats');

  let currentChatId   = null;
  let currentMessages = [];
  let chatsCache      = {};

  function startNewChat() {
    currentChatId = null;
    currentMessages = [];
    chatMessages.innerHTML = '';
    welcomeScreen.classList.remove('hidden');
    chatArea.classList.add('hidden');
    renderHistoryList(searchChats.value);
    const sidebar = document.getElementById('historySidebar');
    const overlay = document.getElementById('historyOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  $('newChatBtn').addEventListener('click', startNewChat);

  async function loadChatList() {
    const user = window.CL.getCurrentUser();
    if (!user) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(user)}`);
      chatsCache = await res.json();
      renderHistoryList();
    } catch (e) {
      console.warn('Could not load chat history', e);
    }
  }

  function renderHistoryList(filter) {
    const items = Object.values(chatsCache).sort((a, b) => b.timestamp - a.timestamp);
    const q = (filter || '').toLowerCase().trim();
    const filtered = !q ? items : items.filter(c =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.messages || []).some(m => (m.content || '').toLowerCase().includes(q))
    );

    historyList.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = q ? 'No matches.' : 'No conversations yet.';
      historyList.appendChild(empty);
      return;
    }

    filtered.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'history-item' + (chat.id === currentChatId ? ' active' : '');

      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = chat.title || 'New chat';

      const del = document.createElement('button');
      del.className = 'history-item-del';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(chat.id); });

      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener('click', () => openChat(chat));
      historyList.appendChild(item);
    });
  }

  function openChat(chat) {
    currentChatId = chat.id;
    currentMessages = (chat.messages || []).slice();
    chatMessages.innerHTML = '';
    currentMessages.forEach(m => addMessage(m.content, m.role));
    welcomeScreen.classList.add('hidden');
    chatArea.classList.remove('hidden');
    renderHistoryList(searchChats.value);
    const sidebar = document.getElementById('historySidebar');
    const overlay = document.getElementById('historyOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }

  async function deleteChat(chatId) {
    const user = window.CL.getCurrentUser();
    if (!user) return;
    try {
      await fetch(
        `/api/chats/${encodeURIComponent(user)}/${encodeURIComponent(chatId)}`,
        { method: 'DELETE' }
      );
    } catch (e) { console.warn('Delete failed', e); }
    delete chatsCache[chatId];
    if (chatId === currentChatId) startNewChat();
    else renderHistoryList(searchChats.value);
  }

  searchChats.addEventListener('input', (e) => renderHistoryList(e.target.value));

  async function persistChat() {
    const user = window.CL.getCurrentUser();
    if (!user || !currentChatId) return;
    const firstUserMsg = currentMessages.find(m => m.role === 'user');
    const title = (firstUserMsg ? firstUserMsg.content : 'New chat').slice(0, 48);
    const chat = { id: currentChatId, title, timestamp: Date.now(), messages: currentMessages };
    chatsCache[currentChatId] = chat;
    renderHistoryList(searchChats.value);
    try {
      await fetch(`/api/chats/${encodeURIComponent(user)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat })
      });
    } catch (e) { console.warn('Save failed', e); }
  }

  // ============================================================
  // MESSAGE RENDERING
  // ============================================================
  function addMessage(content, role, thoughtSeconds) {
    welcomeScreen.classList.add('hidden');
    chatArea.classList.remove('hidden');

    const user = window.CL.getCurrentUser();
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-assistant');

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user'
      ? (user ? user[0].toUpperCase() : 'U')
      : '🐛';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (thoughtSeconds) {
      const think = document.createElement('div');
      think.className = 'msg-think';
      think.textContent = `🧠 Thought for ${thoughtSeconds}s`;
      bubble.appendChild(think);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    if (role === 'user') {
      contentEl.textContent = content;
    } else {
      contentEl.innerHTML = renderMarkdown(content);
      highlightCodeBlocks(contentEl);
    }
    bubble.appendChild(contentEl);

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    chatMessages.appendChild(wrap);
    chatArea.scrollTop = chatArea.scrollHeight;
    return wrap;
  }

  function addTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'msg msg-assistant';
    wrap.innerHTML =
      '<div class="msg-avatar">🐛</div>' +
      '<div class="msg-bubble"><div class="msg-content">' +
      '<div class="typing-dots"><span></span><span></span><span></span></div>' +
      '</div></div>';
    chatMessages.appendChild(wrap);
    chatArea.scrollTop = chatArea.scrollHeight;
    return wrap;
  }

  // ============================================================
  // COMPOSER
  // ============================================================
  const input       = $('input');
  const sendBtn     = $('sendBtn');
  const thinkPanel  = $('thinkPanel');
  const modes       = { think: false, search: false, image: false, bugfinder: false };

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  function wireToggle(id, key) {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      modes[key] = !modes[key];
      btn.classList.toggle('active', modes[key]);
    });
  }
  wireToggle('toggleBugfinder', 'bugfinder');
  wireToggle('toggleThink', 'think');
  wireToggle('toggleSearch', 'search');
  wireToggle('toggleImage', 'image');

  sendBtn.addEventListener('click', sendMessage);

  // ---------- Attachments ----------
  const attachBtn         = $('attachBtn');
  const attachMenu        = $('attachMenu');
  const attachmentPreview = $('attachmentPreview');
  const fileInput         = $('fileInput');
  let attachedFile = null;

  attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    attachMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!attachMenu.classList.contains('hidden') &&
        !attachMenu.contains(e.target) &&
        e.target !== attachBtn) {
      attachMenu.classList.add('hidden');
    }
  });

  $('attachCamera').addEventListener('click', () => openFilePicker('image', true));
  $('attachPhoto').addEventListener('click',  () => openFilePicker('image', false));
  $('attachDoc').addEventListener('click',    () => openFilePicker('text', false));

  const CODE_EXTS = [
    '.txt','.md','.csv','.json','.log',
    '.js','.mjs','.cjs','.jsx','.ts','.tsx',
    '.py','.pyw',
    '.html','.htm','.vue','.svelte',
    '.css','.scss','.sass','.less',
    '.java','.kt','.kts',
    '.c','.h','.cpp','.cc','.cxx','.hpp','.cs',
    '.go','.rs','.rb','.php','.swift',
    '.sh','.bash','.zsh','.ps1',
    '.sql','.xml','.yml','.yaml','.toml','.ini',
    '.r','.lua','.pl','.dart'
  ].join(',');

  function openFilePicker(kind, useCamera) {
    fileInput.value = '';
    fileInput.accept = kind === 'image' ? 'image/*' : CODE_EXTS;
    if (useCamera) fileInput.setAttribute('capture', 'environment');
    else fileInput.removeAttribute('capture');
    fileInput.dataset.kind = kind;
    attachMenu.classList.add('hidden');
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const kind = fileInput.dataset.kind;
    const reader = new FileReader();
    reader.onload = () => {
      attachedFile = { type: kind, data: reader.result, name: file.name };
      renderAttachmentPreview();
    };
    if (kind === 'image') reader.readAsDataURL(file);
    else reader.readAsText(file);
  });

  function renderAttachmentPreview() {
    attachmentPreview.innerHTML = '';
    if (!attachedFile) { attachmentPreview.classList.add('hidden'); return; }
    attachmentPreview.classList.remove('hidden');

    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    if (attachedFile.type === 'image') {
      const img = document.createElement('img');
      img.src = attachedFile.data;
      chip.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'attachment-chip-icon';
      icon.textContent = '📄';
      chip.appendChild(icon);
    }

    const name = document.createElement('span');
    name.textContent = attachedFile.name.length > 20
      ? attachedFile.name.slice(0, 17) + '…'
      : attachedFile.name;
    chip.appendChild(name);

    const remove = document.createElement('button');
    remove.className = 'attachment-chip-remove';
    remove.setAttribute('aria-label', 'Remove attachment');
    remove.textContent = '✕';
    remove.addEventListener('click', () => { attachedFile = null; renderAttachmentPreview(); });
    chip.appendChild(remove);

    attachmentPreview.appendChild(chip);
  }

  // ---------- Send ----------
  async function sendMessage() {
    const text = input.value.trim();
    if (!text && !attachedFile) return;
    if (!currentChatId) currentChatId = Date.now().toString();

    const displayText = text || `(${attachedFile.name})`;
    addMessage(displayText, 'user');
    currentMessages.push({ role: 'user', content: displayText });

    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    const activeModes = { ...modes };
    const fileToSend  = attachedFile;
    attachedFile = null;
    renderAttachmentPreview();

    let typingEl = null;
    if (activeModes.think) {
      thinkPanel.classList.remove('hidden');
      thinkPanel.innerHTML = '<div class="think-spinner"></div><span>Thinking it through…</span>';
    } else {
      typingEl = addTyping();
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: currentMessages.slice(0, -1),
          mode: activeModes,
          attached_file: fileToSend
            ? { type: fileToSend.type, data: fileToSend.data, name: fileToSend.name }
            : undefined
        })
      });
      const data = await res.json();
      thinkPanel.classList.add('hidden');
      if (typingEl) typingEl.remove();

      if (data.error) {
        addMessage(`⚠️ ${data.error}`, 'assistant');
        currentMessages.push({ role: 'assistant', content: data.error });
      } else {
        let replyText = data.reply || '';
        if (data.image_url) replyText += `\n\n![generated image](${data.image_url})`;
        addMessage(replyText, 'assistant', activeModes.think ? data.thought_time : null);
        currentMessages.push({ role: 'assistant', content: replyText });
      }
    } catch (e) {
      thinkPanel.classList.add('hidden');
      if (typingEl) typingEl.remove();
      addMessage('⚠️ Network error — please try again.', 'assistant');
      currentMessages.push({ role: 'assistant', content: 'Network error.' });
    } finally {
      sendBtn.disabled = false;
      persistChat();
    }
  }

  // ============================================================
  // OPTIONAL FLOATING CORNER BUBBLE
  // ============================================================
  const aiCornerBtn = $('aiCornerBtn');
  if (aiCornerBtn) {
    aiCornerBtn.addEventListener('click', () => {
      chatArea.classList.remove('hidden');
      welcomeScreen.classList.add('hidden');
      chatArea.scrollTop = chatArea.scrollHeight;
      input.focus();
    });
  }

  // ============================================================
  // HOOK INTO CORE SESSION EVENTS
  // ============================================================
  window.CL.onLogin(() => {
    startNewChat();
    loadChatList();
  });
  window.CL.onLogout(() => {
    chatsCache = {};
    currentMessages = [];
    currentChatId = null;
    chatMessages.innerHTML = '';
  });

  // ============================================================
  // BOOT
  // ============================================================
  window.CL.start();
})();