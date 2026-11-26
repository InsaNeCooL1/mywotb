'use strict';

import { LS } from './config.js';
import { api } from './api.js';
import { readJSON, writeJSON } from './storage.js';
import { esc, initials, toast } from './ui.js';
import { renderProfile } from './profile.js';
import { renderSessions, sessionsState, sessionCount, initSessionTimers, refreshSession, applyCloudData, switchAccount } from './sessions.js';
import { cloud } from './cloud.js';

const els = {
  search: document.getElementById('player-search'),
  searchBtn: document.getElementById('search-btn'),
  results: document.getElementById('search-results'),
  avatar: document.getElementById('header-avatar'),
  tabbar: document.getElementById('tabbar'),
  count: document.getElementById('session-count'),
  profile: document.getElementById('view-profile'),
  sessions: document.getElementById('view-sessions'),
  authBtn: document.getElementById('auth-btn'),
  installBtn: document.getElementById('install-btn'),
  modal: document.getElementById('auth-modal'),
  authTitle: document.getElementById('auth-title'),
  authEmail: document.getElementById('auth-email'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authError: document.getElementById('auth-error'),
  authStatus: document.getElementById('auth-status'),
  authSubmit: document.getElementById('auth-submit'),
  authSwitch: document.getElementById('auth-switch'),
  authSync: document.getElementById('auth-sync'),
  authLogout: document.getElementById('auth-logout'),
};

const ctx = {
  player: readJSON(LS.player),
  recent: readJSON(LS.recent, []) || [],
  tab: 'profile',
  loadPlayer,
};

/* ---------------- Вкладки ---------------- */
function setTab(name) {
  if (!['profile', 'sessions'].includes(name)) name = 'profile';
  ctx.tab = name;
  els.tabbar.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  els.profile.classList.toggle('hidden', name !== 'profile');
  els.sessions.classList.toggle('hidden', name !== 'sessions');
  if (name === 'profile') renderProfile(els.profile, ctx);
  else renderSessions(els.sessions, ctx);
  history.replaceState(null, '', `#${name}`);
}

els.tabbar.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (tab !== ctx.tab) setTab(tab);
});
window.addEventListener('wotb:player', (event) => applyPlayer(event.detail));

/* ---------------- Пошук гравця ---------------- */
async function loadPlayer(nickname) {
  const name = String(nickname || '').trim();
  if (name.length < 3) { toast('Мінімум 3 символи в нікнеймі', 'error'); return; }
  els.search.value = name;
  hideResults();
  els.searchBtn.innerHTML = '<span class="spinner"></span>';

  try {
    const player = await api.findPlayer(name);
    if (!player) { toast('Гравця не знайдено в регіоні EU', 'error'); return; }
    await applyPlayer(player);
    toast(`Обрано: ${player.nickname}`, 'success');
  } catch (err) {
    toast(err.message || 'Помилка пошуку', 'error');
  } finally {
    els.searchBtn.textContent = '↵';
  }
}

/** Єдина точка зміни гравця: локально, у хмарі й у поточній сесії. */
async function applyPlayer(player, fromCloud = false) {
  const changed = !ctx.player || String(ctx.player.account_id) !== String(player.account_id);
  ctx.player = player;
  writeJSON(LS.player, player);
  ctx.recent = [player, ...ctx.recent.filter((p) => String(p.account_id) !== String(player.account_id))].slice(0, 8);
  writeJSON(LS.recent, ctx.recent);
  updateAvatar();
  els.search.value = player.nickname;
  if (!fromCloud) cloud.savePlayer(player);

  if (changed && sessionsState.active) await switchAccount(ctx, player);
  if (ctx.tab === 'profile') renderProfile(els.profile, ctx);
  else renderSessions(els.sessions, ctx);
}

function updateAvatar() {
  if (!ctx.player) {
    els.avatar.textContent = '—';
    els.avatar.classList.remove('filled');
    els.avatar.title = 'Гравець не обрано';
    return;
  }
  els.avatar.textContent = initials(ctx.player.nickname);
  els.avatar.classList.add('filled');
  els.avatar.title = ctx.player.nickname;
}

let searchTimer = null;
let activeResult = -1;

function hideResults() {
  els.results.classList.add('hidden');
  els.results.innerHTML = '';
  activeResult = -1;
}

function showResults(list) {
  if (!list.length) {
    els.results.innerHTML = '<div class="result-empty">Нічого не знайдено</div>';
    els.results.classList.remove('hidden');
    return;
  }
  els.results.innerHTML = list.map((p, i) => `
    <button class="result-item" type="button" data-index="${i}" data-nick="${esc(p.nickname)}">
      <span class="result-avatar">${esc(initials(p.nickname))}</span>
      <span class="result-name">${esc(p.nickname)}</span>
      <span class="result-id">${esc(p.account_id)}</span>
    </button>`).join('');
  els.results.classList.remove('hidden');
  activeResult = -1;
}

function markResult(index) {
  const items = [...els.results.querySelectorAll('.result-item')];
  if (!items.length) return;
  activeResult = (index + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('kbd', i === activeResult));
  items[activeResult].scrollIntoView({ block: 'nearest' });
}

async function runSearch() {
  const q = els.search.value.trim();
  if (q.length < 3) { hideResults(); return; }
  try {
    showResults(await api.search(q));
  } catch {
    hideResults();
  }
}

els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 280);
});
els.search.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); markResult(activeResult + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); markResult(activeResult - 1); }
  else if (event.key === 'Escape') hideResults();
  else if (event.key === 'Enter') {
    event.preventDefault();
    const items = els.results.querySelectorAll('.result-item');
    const chosen = activeResult >= 0 && items[activeResult]
      ? items[activeResult].dataset.nick
      : els.search.value;
    hideResults();
    loadPlayer(chosen);
  }
});
els.searchBtn.addEventListener('click', () => {
  const items = els.results.querySelectorAll('.result-item');
  const chosen = items[0]?.dataset.nick || els.search.value;
  hideResults();
  loadPlayer(chosen);
});
els.results.addEventListener('click', (event) => {
  const item = event.target.closest('.result-item');
  if (!item) return;
  hideResults();
  loadPlayer(item.dataset.nick);
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-island')) hideResults();
});

/* ---------------- Оновлення ---------------- */
document.getElementById('refresh-btn').addEventListener('click', async () => {
  if (ctx.tab === 'profile') renderProfile(els.profile, ctx);
  else if (sessionsState.active) await refreshSession(els.sessions);
  toast('Дані оновлено', 'success');
});

function updateCount() {
  els.count.textContent = String(sessionCount());
}

/* ---------------- Акаунт / Supabase ---------------- */
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  els.authTitle.textContent = mode === 'login' ? 'Вхід до акаунта' : 'Реєстрація';
  els.authUsername.classList.toggle('hidden', mode !== 'register');
  els.authSubmit.textContent = mode === 'login' ? 'Увійти' : 'Зареєструватися';
  els.authSwitch.textContent = mode === 'login' ? 'Реєстрація' : 'Маю акаунт';
  els.authError.textContent = '';
}

function updateAuthUI() {
  const on = cloud.isOn();
  els.authBtn.textContent = on ? String(cloud.user.email || '').split('@')[0] : 'Увійти';
  els.authBtn.classList.toggle('online', on);
  els.authSync.classList.toggle('hidden', !on);
  els.authLogout.classList.toggle('hidden', !on);
  els.authSubmit.classList.toggle('hidden', on);
  els.authSwitch.classList.toggle('hidden', on);
  els.authStatus.textContent = on
    ? `Синхронізовано: ${cloud.user.email}`
    : cloud.error ? 'Хмара недоступна — працюємо локально' : 'Без входу дані лише в цьому браузері';
}

function openAuth() {
  els.modal.classList.remove('hidden');
  updateAuthUI();
}
function closeAuth() {
  els.modal.classList.add('hidden');
  els.authError.textContent = '';
}

els.authBtn.addEventListener('click', openAuth);
document.getElementById('auth-close').addEventListener('click', closeAuth);
els.modal.addEventListener('click', (event) => {
  if (event.target === els.modal) closeAuth();
});
els.authSwitch.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));

async function submitAuth() {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) { els.authError.textContent = 'Введіть email і пароль'; return; }
  els.authError.textContent = '';
  els.authSubmit.disabled = true;
  try {
    if (authMode === 'login') {
      await cloud.login(email, password);
      closeAuth();
      toast('Вхід виконано — синхронізуємо сесії', 'success');
    } else {
      await cloud.register(email, password);
      els.authError.style.color = 'var(--success)';
      els.authError.textContent = cloud.user
        ? 'Акаунт створено'
        : 'Акаунт створено — підтвердьте email, потім увійдіть';
      setAuthMode('login');
    }
  } catch (err) {
    els.authError.style.color = 'var(--danger)';
    els.authError.textContent = err.message === 'Invalid login credentials'
      ? 'Невірний email або пароль' : `Помилка: ${err.message}`;
  } finally {
    els.authSubmit.disabled = false;
  }
}
els.authSubmit.addEventListener('click', submitAuth);
[els.authEmail, els.authPassword, els.authUsername].forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitAuth(); }
  });
});

async function syncNow() {
  if (!cloud.isOn()) { toast('Спочатку увійдіть в акаунт', 'error'); return; }
  try {
    const data = await cloud.pull();
    applyCloudData(data, ctx.player?.account_id);
    await cloud.pushNow(sessionsState.history, sessionsState.active);
    updateCount();
    if (ctx.tab === 'sessions') renderSessions(els.sessions, ctx);
    toast('Сесії синхронізовано', 'success');
  } catch (err) {
    toast(`Помилка синхронізації: ${err.message}`, 'error');
  }
}
els.authSync.addEventListener('click', syncNow);
els.authLogout.addEventListener('click', async () => {
  try {
    await cloud.logout();
    toast('Вийшли з акаунта', 'success');
    updateAuthUI();
  } catch (err) {
    toast(err.message, 'error');
  }
});

cloud.onChange(async (kind) => {
  updateAuthUI();
  if (kind !== 'auth' || !cloud.isOn()) return;
  try {
    // Вибраний гравець прив'язаний до акаунта Supabase, а не до браузера.
    const cloudPlayer = await cloud.pullPlayer();
    if (cloudPlayer && (!ctx.player || String(ctx.player.account_id) !== String(cloudPlayer.account_id))) {
      await applyPlayer(cloudPlayer, true);
    } else if (ctx.player && !cloudPlayer) {
      await cloud.savePlayerNow(ctx.player);
    }
    await syncNow();
  } catch (err) {
    toast(`Помилка синхронізації акаунта: ${err.message}`, 'error');
  }
});

/* ---------------- PWA ---------------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн без SW */ });
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  els.installBtn.classList.remove('hidden');
});
els.installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => els.installBtn.classList.add('hidden'));

/* ---------------- Старт ---------------- */
updateAvatar();
updateCount();
updateAuthUI();
setAuthMode('login');
if (ctx.player) els.search.value = ctx.player.nickname;
setTab(location.hash.slice(1) || 'profile');
initSessionTimers(ctx);

// Сесія завжди має належати вибраному гравцю — навіть після перезавантаження.
if (ctx.player && sessionsState.active
    && String(sessionsState.active.accountId) !== String(ctx.player.account_id)) {
  switchAccount(ctx, ctx.player).then(() => {
    if (ctx.tab === 'sessions') renderSessions(els.sessions, ctx);
  });
}
cloud.init();

// Без збереженого гравця не підміняємо його демо-акаунтом: користувач обирає сам.
// Якщо є акаунт Supabase — viewer буде підтягнутий з хмари в onChange('auth').

// Лічильник сесій оновлюємо разом із таймером.
setInterval(updateCount, 2000);
