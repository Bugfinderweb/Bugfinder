// ============================================================
// CodeBugFinder — core.js
// Helpers • Auth (signup / login / forgot PIN) • Session • Sidebar • Settings
// Exposes window.CL = { onLogin, onLogout, getCurrentUser, logout, start }
// ============================================================

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const setText = (el, v) => { if (el) el.textContent = v; };

  // ============================================================
  // SCREEN SWITCHING
  // ============================================================
  const signupScreen = $('signupScreen');
  const loginScreen  = $('loginScreen');
  const forgotScreen = $('forgotScreen');
  const appRoot      = $('appRoot');

  function hideAllScreens() {
    signupScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    forgotScreen.classList.add('hidden');
    appRoot.classList.add('hidden');
  }
  function clearAllErrorsIn(screenEl) {
    qsa('.auth-error', screenEl).forEach(el => el.remove());
  }

  window.showSignup = function () {
    hideAllScreens();
    signupScreen.classList.remove('hidden');
    resetSignupFlow();
  };
  window.showLogin = function () {
    hideAllScreens();
    loginScreen.classList.remove('hidden');
    resetLoginFlow();
  };
  function showForgot() {
    hideAllScreens();
    forgotScreen.classList.remove('hidden');
    resetForgotFlow();
  }
  function showApp() {
    hideAllScreens();
    appRoot.classList.remove('hidden');
  }

  // ============================================================
  // ERROR HELPER
  // ============================================================
  function showError(afterEl, message) {
    const existing = afterEl.parentElement.querySelector('.auth-error');
    if (existing) existing.remove();
    const p = document.createElement('p');
    p.className = 'auth-error';
    p.textContent = message;
    afterEl.insertAdjacentElement('afterend', p);
  }

  // ============================================================
  // PIN HASHING (SHA-256, hex)
  // ============================================================
  async function hashPin(pin) {
    const enc = new TextEncoder().encode(pin);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ============================================================
  // PIN PAD BUILDER
  // ============================================================
  function buildPinPad(padEl, dotsEl, onComplete) {
    let value = '';
    const dots = qsa('span', dotsEl);

    function render() { dots.forEach((d, i) => d.classList.toggle('filled', i < value.length)); }
    function reset() { value = ''; render(); }
    function press(digit) {
      if (value.length >= 4) return;
      value += digit;
      render();
      if (value.length === 4) { const pin = value; setTimeout(() => onComplete(pin), 120); }
    }
    function backspace() { value = value.slice(0, -1); render(); }

    padEl.innerHTML = '';
    ['1','2','3','4','5','6','7','8','9','','0','del'].forEach(key => {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (key === '') {
        btn.className = 'pin-key pin-key-ghost';
        btn.disabled = true;
        btn.tabIndex = -1;
      } else if (key === 'del') {
        btn.className = 'pin-key pin-key-del';
        btn.textContent = '⌫';
        btn.addEventListener('click', backspace);
      } else {
        btn.className = 'pin-key';
        btn.textContent = key;
        btn.addEventListener('click', () => press(key));
      }
      padEl.appendChild(btn);
    });

    render();
    return { reset };
  }

  // ============================================================
  // SIGNUP FLOW
  // ============================================================
  const stepName        = $('stepName');
  const stepPin         = $('stepPin');
  const stepPinConfirm  = $('stepPinConfirm');
  const stepSecurity    = $('stepSecurity');

  let signupData = { username: '', pin: '' };

  function resetSignupFlow() {
    signupData = { username: '', pin: '' };
    stepName.classList.remove('hidden');
    stepPin.classList.add('hidden');
    stepPinConfirm.classList.add('hidden');
    stepSecurity.classList.add('hidden');
    $('signupName').value = '';
    $('qRealName').value = '';
    $('qPet').value = '';
    $('qAge').value = '';
    clearAllErrorsIn(signupScreen);
  }

  $('signupNameBtn').addEventListener('click', () => {
    const name = $('signupName').value.trim();
    if (!name) { showError($('signupNameBtn'), 'Please enter a nickname.'); return; }
    clearAllErrorsIn(signupScreen);
    signupData.username = name;
    setText($('greetName'), name);
    stepName.classList.add('hidden');
    stepPin.classList.remove('hidden');

    buildPinPad($('signupPinPad'), $('signupPinDots'), (pin) => {
      signupData.pin = pin;
      stepPin.classList.add('hidden');
      stepPinConfirm.classList.remove('hidden');

      const confirmPad = buildPinPad(
        $('signupPinPadConfirm'),
        $('signupPinDotsConfirm'),
        (confirmPin) => {
          if (confirmPin !== signupData.pin) {
            showError($('signupPinPadConfirm'), "PINs don't match — try again.");
            confirmPad.reset();
            return;
          }
          clearAllErrorsIn(signupScreen);
          stepPinConfirm.classList.add('hidden');
          stepSecurity.classList.remove('hidden');
        }
      );
    });
  });

  $('signupSubmitBtn').addEventListener('click', async () => {
    const real_name = $('qRealName').value.trim();
    const pet_pref  = $('qPet').value;
    const age       = $('qAge').value.trim();
    if (!real_name || !pet_pref || !age) {
      showError($('signupSubmitBtn'), 'Please answer all three questions.');
      return;
    }
    clearAllErrorsIn(signupScreen);
    $('signupSubmitBtn').disabled = true;
    try {
      const pin_hash = await hashPin(signupData.pin);
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: signupData.username,
          pin_hash, real_name, pet_pref, age
        })
      });
      const data = await res.json();
      if (res.ok) loginUser(signupData.username);
      else showError($('signupSubmitBtn'), data.error || 'Something went wrong.');
    } catch (e) {
      showError($('signupSubmitBtn'), 'Network error — please try again.');
    } finally {
      $('signupSubmitBtn').disabled = false;
    }
  });

  // ============================================================
  // LOGIN FLOW
  // ============================================================
  const loginStepName = $('loginStepName');
  const loginStepPin  = $('loginStepPin');
  let loginUsername   = '';

  function resetLoginFlow() {
    loginUsername = '';
    loginStepName.classList.remove('hidden');
    loginStepPin.classList.add('hidden');
    $('loginNameInput').value = '';
    clearAllErrorsIn(loginScreen);
  }

  $('loginNameBtn').addEventListener('click', () => {
    const name = $('loginNameInput').value.trim();
    if (!name) { showError($('loginNameBtn'), 'Please enter your nickname.'); return; }
    clearAllErrorsIn(loginScreen);
    loginUsername = name;
    setText($('loginGreetName'), name);
    loginStepName.classList.add('hidden');
    loginStepPin.classList.remove('hidden');

    const pad = buildPinPad($('loginPinPad'), $('loginPinDots'), async (pin) => {
      clearAllErrorsIn(loginScreen);
      try {
        const pin_hash = await hashPin(pin);
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginUsername, pin_hash })
        });
        const data = await res.json();
        if (res.ok) loginUser(loginUsername);
        else { showError($('forgotPinBtn'), data.error || 'Incorrect username or PIN.'); pad.reset(); }
      } catch (e) {
        showError($('forgotPinBtn'), 'Network error — please try again.');
        pad.reset();
      }
    });
  });

  $('forgotPinBtn').addEventListener('click', () => showForgot());

  // ============================================================
  // FORGOT PIN FLOW
  // ============================================================
  const forgotStepName      = $('forgotStepName');
  const forgotStepQuestions = $('forgotStepQuestions');
  const forgotStepNewPin    = $('forgotStepNewPin');
  let forgotData = { username: '', real_name: '', pet_pref: '', age: '' };

  function resetForgotFlow() {
    forgotData = { username: '', real_name: '', pet_pref: '', age: '' };
    forgotStepName.classList.remove('hidden');
    forgotStepQuestions.classList.add('hidden');
    forgotStepNewPin.classList.add('hidden');
    $('forgotNameInput').value = '';
    $('fRealName').value = '';
    $('fPet').value = '';
    $('fAge').value = '';
    clearAllErrorsIn(forgotScreen);
  }

  $('forgotNameBtn').addEventListener('click', () => {
    const name = $('forgotNameInput').value.trim();
    if (!name) { showError($('forgotNameBtn'), 'Please enter your nickname.'); return; }
    clearAllErrorsIn(forgotScreen);
    forgotData.username = name;
    forgotStepName.classList.add('hidden');
    forgotStepQuestions.classList.remove('hidden');
  });

  $('forgotVerifyBtn').addEventListener('click', () => {
    const real_name = $('fRealName').value.trim();
    const pet_pref  = $('fPet').value;
    const age       = $('fAge').value.trim();
    if (!real_name || !pet_pref || !age) {
      showError($('forgotVerifyBtn'), 'Please answer all three questions.');
      return;
    }
    clearAllErrorsIn(forgotScreen);
    forgotData.real_name = real_name;
    forgotData.pet_pref  = pet_pref;
    forgotData.age       = age;
    forgotStepQuestions.classList.add('hidden');
    forgotStepNewPin.classList.remove('hidden');

    buildPinPad($('forgotPinPad'), $('forgotPinDots'), async (newPin) => {
      try {
        const new_pin_hash = await hashPin(newPin);
        const res = await fetch('/api/reset-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...forgotData, new_pin_hash })
        });
        const data = await res.json();
        if (res.ok) showLogin();
        else {
          forgotStepNewPin.classList.add('hidden');
          forgotStepQuestions.classList.remove('hidden');
          showError($('forgotVerifyBtn'), data.error || 'Verification failed — try again.');
        }
      } catch (e) {
        forgotStepNewPin.classList.add('hidden');
        forgotStepQuestions.classList.remove('hidden');
        showError($('forgotVerifyBtn'), 'Network error — please try again.');
      }
    });
  });

  // ============================================================
  // SESSION
  // ============================================================
  let currentUser = null;
  const loginCallbacks  = [];
  const logoutCallbacks = [];

  function onLogin(cb)  { if (typeof cb === 'function') loginCallbacks.push(cb); }
  function onLogout(cb) { if (typeof cb === 'function') logoutCallbacks.push(cb); }
  function getCurrentUser() { return currentUser; }

  function loginUser(username) {
    currentUser = username;
    try { localStorage.setItem('cl_user', username); } catch (e) {}

    const initial = username[0].toUpperCase();
    setText($('userAvatar'), initial);
    setText($('userName'), username);
    setText($('settingsAvatar'), initial);
    setText($('settingsName'), username);

    showApp();
    loginCallbacks.forEach(cb => { try { cb(username); } catch (e) { console.error(e); } });
  }

  function logout() {
    currentUser = null;
    try { localStorage.removeItem('cl_user'); } catch (e) {}
    const sm = $('settingsMenu'); if (sm) sm.classList.add('hidden');
    logoutCallbacks.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
    showLogin();
  }

  $('logoutBtn').addEventListener('click', logout);
  const settingsLogoutBtn = $('settingsLogoutBtn');
  if (settingsLogoutBtn) settingsLogoutBtn.addEventListener('click', logout);

  // ============================================================
  // SIDEBAR
  // ============================================================
  const historySidebar = $('historySidebar');
  const historyOverlay = $('historyOverlay');
  function openSidebar()  { historySidebar.classList.add('open');  historyOverlay.classList.add('show'); }
  function closeSidebar() { historySidebar.classList.remove('open'); historyOverlay.classList.remove('show'); }
  $('menuBtn').addEventListener('click', openSidebar);
  $('closeHistory').addEventListener('click', closeSidebar);
  historyOverlay.addEventListener('click', closeSidebar);

  // ============================================================
  // SETTINGS MENU (optional element)
  // ============================================================
  const settingsMenu = $('settingsMenu');
  if (settingsMenu) {
    $('settingsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!settingsMenu.classList.contains('hidden') &&
          !settingsMenu.contains(e.target) &&
          e.target !== $('settingsBtn')) {
        settingsMenu.classList.add('hidden');
      }
    });
  }

  // ============================================================
  // PUBLIC API + BOOT
  // ============================================================
  window.CL = { onLogin, onLogout, getCurrentUser, logout };

  window.CL.start = function () {
    let saved = null;
    try { saved = localStorage.getItem('cl_user'); } catch (e) {}
    if (saved) loginUser(saved);
    else showSignup();
  };
})();