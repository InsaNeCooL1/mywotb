'use strict';

/** Безпечне вставлення рядків у HTML-шаблони. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtInt(value) {
  return Math.round(Number(value) || 0).toLocaleString('uk-UA');
}

export function fmtNum(value, digits = 0) {
  const n = Number(value) || 0;
  return n.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(part, total, digits = 1) {
  if (!total) return '—';
  return `${fmtNum((part / total) * 100, digits)}%`;
}

export function initials(name) {
  return String(name || '?').trim().slice(0, 2).toUpperCase();
}

export function toneForRatio(value) {
  if (value >= 0.55) return 'mint';
  if (value >= 0.45) return 'accent';
  return 'coral';
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

export function fmtDurationHuman(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} год ${m} хв`;
  if (m) return `${m} хв ${s % 60} с`;
  return `${s} с`;
}

export function fmtDate(ts, withTime = true) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

export function emptyState({ glyph = '✦', title, text, action = '' }) {
  return `
    <div class="empty">
      <div class="empty-glyph">${esc(glyph)}</div>
      <div class="empty-title">${esc(title)}</div>
      <p class="empty-text">${esc(text)}</p>
      ${action ? `<div class="empty-actions">${action}</div>` : ''}
    </div>`;
}

export function skeletons(count = 6) {
  return Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
}

/** Дельта між двома знімками статистики (дані API — накопичувальні). */
export function delta(before = {}, after = {}) {
  const d = (key) => Math.max(0, (Number(after[key]) || 0) - (Number(before[key]) || 0));
  const out = {};
  for (const key of [
    'battles', 'wins', 'losses', 'frags', 'damage_dealt', 'damage_received',
    'xp', 'hits', 'shots', 'spotted', 'capture_points', 'dropped_capture_points',
    'survived_battles',
  ]) out[key] = d(key);

  out.winrate = out.battles ? (out.wins / out.battles) * 100 : 0;
  out.avgDamage = out.battles ? out.damage_dealt / out.battles : 0;
  out.accuracy = out.shots ? (out.hits / out.shots) * 100 : 0;
  out.survivalRate = out.battles ? (out.survived_battles / out.battles) * 100 : 0;
  return out;
}

export function snapshot(info) {
  const all = info?.statistics?.all || {};
  const out = {};
  for (const key of [
    'battles', 'wins', 'losses', 'frags', 'damage_dealt', 'damage_received',
    'xp', 'hits', 'shots', 'spotted', 'capture_points', 'dropped_capture_points',
    'survived_battles',
  ]) out[key] = Number(all[key]) || 0;
  return out;
}
