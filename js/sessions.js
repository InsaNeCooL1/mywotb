'use strict';

import { api } from './api.js';
import { LS, LIVE_REFRESH_MS } from './config.js';
import { readJSON, writeJSON } from './storage.js';
import { cloud } from './cloud.js';
import {
  esc, fmtInt, fmtNum, fmtDurationHuman, fmtDate,
  emptyState, delta, snapshot, toast,
} from './ui.js';

function tankMap(tanks) {
  const out = {};
  (tanks || []).forEach((t) => {
    out[String(t.tank_id)] = snapshot({ statistics: { all: t.all || {} } });
  });
  return out;
}

/** Старі записи (без даних по танках) не ламаються. */
function normalize(item) {
  if (!item) return item;
  return {
    ...item,
    totalBefore: item.totalBefore || item.before || {},
    totalAfter: item.totalAfter || item.latest || item.after || {},
    tanksBefore: item.tanksBefore || {},
    tanksLatest: item.tanksLatest || item.tanksAfter || {},
  };
}

export const sessionsState = {
  active: normalize(readJSON(LS.active)),
  history: (readJSON(LS.sessions, []) || []).map(normalize),
};

function save() {
  writeJSON(LS.active, sessionsState.active || null);
  writeJSON(LS.sessions, sessionsState.history);
  cloud.push(sessionsState.history, sessionsState.active);
}

export function sessionCount() {
  return sessionsState.history.length + (sessionsState.active ? 1 : 0);
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `s${Date.now()}${Math.random().toString(16).slice(2)}`;
}

let vehiclesCache = null;
async function vehicles() {
  if (!vehiclesCache) vehiclesCache = await api.vehicles().catch(() => ({}));
  return vehiclesCache;
}

function tankDeltas(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const rows = [...ids].map((id) => delta(before?.[id] || {}, after?.[id] || {}));
  rows.forEach((d, i) => { d.tankId = [...ids][i]; });
  return rows.filter((d) => d.battles > 0).sort((a, b) => b.battles - a.battles);
}

function metricCells(d) {
  return [
    { label: 'Боїв', value: `+${fmtInt(d.battles)}`, tone: 'accent' },
    { label: 'Вінрейт / % перемог', value: `${fmtNum(d.winrate, 2)}%`, tone: 'mint' },
    { label: 'Середня шкода', value: fmtInt(d.avgDamage), tone: '' },
    { label: 'Виживання', value: `${fmtNum(d.survivalRate, 2)}%`, tone: 'mint' },
  ].map((c) => `
    <div class="delta-cell">
      <div class="delta-label">${esc(c.label)}</div>
      <div class="delta-value ${c.tone}">${esc(c.value)}</div>
    </div>`).join('');
}

function tankTable(before, after, dict, totalD) {
  const rowsAll = tankDeltas(before, after);
  const rows = rowsAll.slice(0, 20);
  const body = rows.length ? rows.map((d) => {
    const v = dict[String(d.tankId)] || {};
    return `<tr>
      <td>${esc(v.name || `Танк #${d.tankId}`)}</td>
      <td class="num">${fmtInt(d.battles)}</td>
      <td class="num">${fmtNum(d.winrate, 2)}%</td>
      <td class="num">${fmtInt(d.avgDamage)}</td>
      <td class="num">${fmtNum(d.survivalRate, 2)}%</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="tank-empty-cell">За цю сесію боїв на техніці ще немає.</td></tr>';
  const more = rowsAll.length > rows.length
    ? `<tr><td colspan="5" class="tank-empty-cell">Показано топ-${rows.length} з ${rowsAll.length} машин за кількістю боїв</td></tr>`
    : '';
  return `<div class="tank-panel session-tank-panel">
    <table class="tank-table">
      <thead><tr><th>Машина</th><th class="num">Боїв</th><th class="num">Вінрейт / % перемог</th><th class="num">Середня шкода</th><th class="num">Виживання</th></tr></thead>
      <tbody>
        ${body}
        ${more}
        <tr class="total-row">
          <td>Загалом</td>
          <td class="num">${fmtInt(totalD.battles)}</td>
          <td class="num">${fmtNum(totalD.winrate, 2)}%</td>
          <td class="num">${fmtInt(totalD.avgDamage)}</td>
          <td class="num">${fmtNum(totalD.survivalRate, 2)}%</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

function activePanel(a) {
  const d = delta(a.totalBefore, a.totalLatest);
  return `
    <div class="session-hero active">
      <div class="session-hero-head">
        <div>
          <div class="session-hero-title">Поточна сесія</div>
          <div class="session-hero-sub">Гравець <b>${esc(a.nickname)}</b> · початок ${esc(fmtDate(a.startedAt))} · дані від ${esc(fmtDate(a.lastSyncAt || a.startedAt))}</div>
        </div>
        <span class="meta-pill accent">● LIVE</span>
      </div>
      <input class="note-input" id="session-note" type="text" maxlength="160"
             placeholder="Нотатка до сесії (необов'язково)" value="${esc(a.note || '')}">
      <div class="btn-row">
        <button class="btn-primary" id="finish-session" type="button">Завершити поточну сесію</button>
      </div>
      <div class="delta-grid" id="live-deltas">${metricCells(d)}</div>
    </div>
    <div class="section-head">
      <div class="section-title">По танках</div>
      <div class="section-hint">Кожен танк окремо + загальний підсумок сесії</div>
    </div>
    <div id="live-tanks"></div>`;
}

function idlePanel(ctx) {
  return `
    <div class="session-hero">
      <div class="session-hero-head">
        <div>
          <div class="session-hero-title">Сесія ще не почалась</div>
          <div class="session-hero-sub">${ctx.player
            ? `Гравець: <b>${esc(ctx.player.nickname)}</b>.`
            : 'Спочатку оберіть гравця у вкладці «Профіль».'} Сесія стартує автоматично, коли ви обрали гравця.</div>
        </div>
      </div>
    </div>`;
}

function historyItem(item, dict) {
  const d = item.deltas || delta(item.totalBefore, item.totalAfter);
  const when = item.endedAt
    ? `${fmtDate(item.startedAt)} — ${fmtDate(item.endedAt)}`
    : fmtDate(item.startedAt);
  return `
    <div class="history-item">
      <div class="history-top">
        <div>
          <div class="history-when">${esc(when)} ${item.demo ? '<span class="meta-pill">демо</span>' : ''}</div>
          <div class="history-sub">Гравець <b>${esc(item.nickname)}</b> · тривалість <b>${esc(fmtDurationHuman(item.durationSec))}</b></div>
        </div>
        <button class="icon-delete" data-delete="${esc(item.id)}" type="button" title="Видалити запис">✕</button>
      </div>
      ${item.note ? `<div class="history-note">${esc(item.note)}</div>` : ''}
      <div class="history-chips">
        <span class="chip">Боїв <b>+${fmtInt(d.battles)}</b></span>
        <span class="chip mint">Вінрейт <b>${fmtNum(d.winrate, 2)}%</b></span>
        <span class="chip">Середня шкода <b>${fmtInt(d.avgDamage)}</b></span>
        <span class="chip mint">Виживання <b>${fmtNum(d.survivalRate, 2)}%</b></span>
      </div>
      <button class="details-btn" data-details="${esc(item.id)}" type="button">Деталі по танках ▾</button>
      <div class="details-body hidden" data-body="${esc(item.id)}">${tankTable(item.tanksBefore, item.tanksAfter, dict, d)}</div>
    </div>`;
}

function historyPanel(ctx, dict) {
  const items = [...sessionsState.history].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return `
    <div class="history-head">
      <div>
        <div class="section-title">Історія сесій</div>
        <div class="section-hint">${items.length ? `${items.length} записів · синхронізація з хмарою, якщо увійшли в акаунт` : 'Поки немає завершених сесій'}</div>
      </div>
      ${items.length ? '<button class="btn-ghost btn-danger" id="clear-history" type="button">Очистити історію</button>' : ''}
    </div>
    ${items.length
      ? `<div class="history-list">${items.map((i) => historyItem(i, dict)).join('')}</div>`
      : emptyState({
          glyph: '◷', title: 'Історія порожня',
          text: 'Завершіть першу сесію — тут буде підсумок і розбивка по кожному танку.',
          action: ctx.player ? '<button class="btn-ghost" id="demo-history" type="button">Додати приклад запису</button>' : '',
        })}`;
}

/** Повний рендер вкладки «Сесії». */
export async function renderSessions(view, ctx) {
  // Сесії безперервні: якщо активної немає — стартуємо одразу.
  if (!sessionsState.active && ctx.player) await startSession(ctx, true);
  const dict = await vehicles();
  view.innerHTML = (sessionsState.active ? activePanel(sessionsState.active) : idlePanel(ctx))
    + historyPanel(ctx, dict);
  bind(view, ctx, dict);
  if (sessionsState.active) await updateLiveTanks(view, dict);
}

async function updateLiveTanks(view, dict) {
  const host = view.querySelector('#live-tanks');
  if (!host || !sessionsState.active) return;
  const a = sessionsState.active;
  const d = delta(a.totalBefore, a.totalLatest);
  host.innerHTML = tankTable(a.tanksBefore, a.tanksLatest, dict, d);
}

function bind(view, ctx) {
  view.querySelector('#finish-session')?.addEventListener('click', () => finishSession(view, ctx));

  view.querySelector('#clear-history')?.addEventListener('click', async () => {
    if (!confirm('Видалити всю історію сесій?')) return;
    sessionsState.history = [];
    save();
    await cloud.clearSessions();
    renderSessions(view, ctx);
    toast('Історію очищено', 'success');
  });

  view.querySelector('#demo-history')?.addEventListener('click', () => addDemoHistory(ctx));

  view.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delete;
      sessionsState.history = sessionsState.history.filter((s) => s.id !== id);
      save();
      await cloud.deleteSession(id);
      renderSessions(view, ctx);
      toast('Запис видалено');
    });
  });

  view.querySelectorAll('[data-details]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = view.querySelector(`[data-body="${btn.dataset.details}"]`);
      if (!body) return;
      body.classList.toggle('hidden');
      btn.textContent = body.classList.contains('hidden') ? 'Деталі по танках ▾' : 'Згорнути ▴';
    });
  });
}

async function fetchSnapshot(accountId) {
  const [info, tanks] = await Promise.all([
    api.accountInfo(accountId),
    api.tankStats(accountId),
  ]);
  if (!info) throw new Error('Акаунт не знайдено');
  return {
    nickname: info.nickname,
    total: snapshot(info),
    tanks: tankMap(tanks),
  };
}

export async function startSession(ctx, silent = false) {
  if (!ctx.player) { if (!silent) toast('Спочатку оберіть гравця', 'error'); return; }
  try {
    const snap = await fetchSnapshot(ctx.player.account_id);
    const now = Date.now() / 1000;
    sessionsState.active = {
      id: uid(), accountId: ctx.player.account_id, nickname: snap.nickname,
      startedAt: now, lastSyncAt: now, note: '',
      totalBefore: snap.total, totalLatest: snap.total,
      tanksBefore: snap.tanks, tanksLatest: snap.tanks,
    };
    save();
    scheduleAutoRefresh();
    if (!silent) toast('Сесію почато — статистику зафіксовано', 'success');
  } catch (err) {
    if (!silent) toast(err.message || 'Не вдалося почати сесію', 'error');
  }
}

export async function refreshSession(view, dictOverride, silent = false) {
  const a = sessionsState.active;
  if (!a) return;
  try {
    const snap = await fetchSnapshot(a.accountId);
    a.totalLatest = snap.total;
    a.tanksLatest = snap.tanks;
    a.lastSyncAt = Date.now() / 1000;
    save();
    const dict = dictOverride || await vehicles();
    const deltas = view.querySelector('#live-deltas');
    if (deltas) deltas.innerHTML = metricCells(delta(a.totalBefore, a.totalLatest));
    await updateLiveTanks(view, dict);
    const stamp = view.querySelector('.session-hero-sub');
    if (stamp) stamp.innerHTML = `Гравець <b>${esc(a.nickname)}</b> · початок ${esc(fmtDate(a.startedAt))} · дані від ${esc(fmtDate(a.lastSyncAt))}`;
    if (!silent) toast('Статистику оновлено', 'success');
  } catch (err) {
    if (!silent) toast(err.message || 'Не вдалося оновити', 'error');
  }
}

export async function finishSession(view, ctx) {
  const a = sessionsState.active;
  if (!a) return;
  const noteInput = view.querySelector('#session-note');
  if (noteInput) a.note = noteInput.value.trim();
  const btn = view.querySelector('#finish-session');
  if (btn) btn.innerHTML = '<span class="spinner"></span>Збереження…';

  try {
    const snap = await fetchSnapshot(a.accountId);
    const endedAt = Date.now() / 1000;
    sessionsState.history.push({
      id: a.id, accountId: a.accountId, nickname: a.nickname,
      startedAt: a.startedAt, endedAt, durationSec: Math.round(endedAt - a.startedAt),
      note: a.note || '',
      totalBefore: a.totalBefore, totalAfter: snap.total,
      tanksBefore: a.tanksBefore, tanksAfter: snap.tanks,
      deltas: delta(a.totalBefore, snap.total),
    });
    // Одна сесія одразу змінюється наступною — таймер і кнопка старту не потрібні.
    const now = Date.now() / 1000;
    sessionsState.active = {
      id: uid(), accountId: a.accountId, nickname: snap.nickname,
      startedAt: now, lastSyncAt: now, note: '',
      totalBefore: snap.total, totalLatest: snap.total,
      tanksBefore: snap.tanks, tanksLatest: snap.tanks,
    };
    save();
    scheduleAutoRefresh();
    toast('Сесію збережено — почато нову', 'success');
  } catch (err) {
    toast(err.message || 'Не вдалося завершити сесію', 'error');
  }
  await renderSessions(view, ctx);
}

let autoTimer = null;
export function scheduleAutoRefresh() {
  clearAutoRefresh();
  if (!sessionsState.active) return;
  autoTimer = setInterval(() => {
    if (!sessionsState.active) return clearAutoRefresh();
    const view = document.getElementById('view-sessions');
    refreshSession(view, null, true);
  }, LIVE_REFRESH_MS);
}

function clearAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}

export function initSessionTimers() {
  if (sessionsState.active) scheduleAutoRefresh();
}

/** Підтягнути дані з хмари (викликає app.js після входу). */
export function applyCloudData(data) {
  if (!data) return;
  const cloudHistory = (data.history || []).map(normalize);
  const merged = new Map(sessionsState.history.map((s) => [s.id, s]));
  cloudHistory.forEach((s) => {
    const local = merged.get(s.id);
    if (!local || (s.endedAt || 0) > (local.endedAt || 0)) merged.set(s.id, s);
  });
  sessionsState.history = [...merged.values()];
  if (!sessionsState.active && data.active) sessionsState.active = normalize(data.active);
  writeJSON(LS.active, sessionsState.active || null);
  writeJSON(LS.sessions, sessionsState.history);
}

/** Демонстраційний запис, щоб показати вигляд історії. */
function addDemoHistory(ctx) {
  const mk = (battles, wins, damage, survived, xp) => ({
    battles, wins, losses: battles - wins, damage_dealt: damage, frags: Math.round(battles / 3),
    xp, hits: Math.round(battles * 5), shots: Math.round(battles * 7), survived_battles: survived,
    spotted: Math.round(battles / 2), capture_points: 0, dropped_capture_points: 0,
  });
  const now = Date.now() / 1000;
  const pairs = [
    ['1234', mk(0, 0, 0, 0, 0), mk(7, 4, 14800, 3, 5600)],
    ['20849', mk(0, 0, 0, 0, 0), mk(5, 3, 10200, 2, 4100)],
  ];
  const tanksBefore = {};
  const tanksAfter = {};
  pairs.forEach(([id, b, a]) => { tanksBefore[id] = b; tanksAfter[id] = a; });
  const totalBefore = mk(1240, 610, 210000, 380, 310000);
  const totalAfter = mk(1252, 617, 235000, 385, 319700);
  sessionsState.history.push({
    id: uid(), accountId: ctx.player?.account_id, nickname: ctx.player?.nickname || 'Демо',
    startedAt: now - 1860, endedAt: now, durationSec: 1860,
    note: 'Приклад сесії: вечірні бої на важкій техніці',
    totalBefore, totalAfter, tanksBefore, tanksAfter,
    deltas: delta(totalBefore, totalAfter), demo: true,
  });
  save();
  const view = document.getElementById('view-sessions');
  renderSessions(view, ctx);
  toast('Додано приклад сесії', 'success');
}
