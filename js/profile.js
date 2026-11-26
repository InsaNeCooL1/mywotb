'use strict';

import { api } from './api.js';
import { DEFAULT_NICKNAME } from './config.js';
import { esc, fmtInt, pct, initials, fmtDate, emptyState, skeletons, toast } from './ui.js';

const TYPE_META = {
  lightTank: {
    label: 'Легкий танк', cls: 'light',
    svg: '<path d="M12 4l7 8-7 8-7-8z"/>',
  },
  mediumTank: {
    label: 'Середній танк', cls: 'medium',
    svg: '<path d="M6 17l2-10h2l-2 10zM12 17l2-10h2l-2 10z"/>',
  },
  heavyTank: {
    label: 'Важкий танк', cls: 'heavy',
    svg: '<path d="M4 17l2-10h2l-2 10zM10 17l2-10h2l-2 10zM16 17l2-10h2l-2 10z"/>',
  },
  'AT-SPG': {
    label: 'Протитанкова САУ', cls: 'td',
    svg: '<path d="M4 8h16l-8 12z"/>',
  },
  SPG: {
    label: 'Самохідна артилерія', cls: 'spg',
    svg: '<circle cx="12" cy="12" r="5"/><path d="M11 2h2v4h-2zM11 18h2v4h-2zM2 11h4v2H2zM18 11h4v2h-4z"/>',
  },
};

function classIcon(type) {
  const meta = TYPE_META[type];
  if (!meta) return '';
  return `<svg class="class-icon ${meta.cls}" viewBox="0 0 24 24" fill="currentColor"
    role="img" aria-label="${esc(meta.label)}" title="${esc(meta.label)}">${meta.svg}</svg>`;
}

let showAllTanks = false;
let tankSort = { key: 'battles', dir: 'desc' };

function hero(info) {
  const s = info.statistics?.all || {};
  const nick = info.nickname || 'Гравець';
  return `
    <div class="hero">
      <div class="hero-top">
        <div class="hero-avatar">${esc(initials(nick))}</div>
        <div class="hero-id">
          <div class="hero-name">${esc(nick)}</div>
          <div class="hero-meta">
            <span class="meta-pill accent">● EU · Blitz</span>
            <span class="meta-pill">ID ${esc(info.account_id)}</span>
            <span class="meta-pill">Акаунт: ${esc(fmtDate(info.created_at, false))}</span>
            <span class="meta-pill">Останній бій: ${esc(fmtDate(info.last_battle_time))}</span>
          </div>
        </div>
        <div class="hero-rank">
          <div class="hero-rank-label">Боїв</div>
          <div class="hero-rank-value">${fmtInt(s.battles)}</div>
        </div>
      </div>
    </div>`;
}

/** Лише три метрики: бої, відсоток перемог (2 знаки), середня шкода. */
function statsGrid(s) {
  return [
    {
      label: 'Кількість боїв', value: fmtInt(s.battles),
      sub: `${fmtInt(s.wins)} перемог · ${fmtInt(s.losses)} поразок`,
    },
    { label: 'Відсоток перемог', value: pct(s.wins, s.battles, 2), sub: 'win rate', tone: 'mint' },
    {
      label: 'Середня шкода', value: fmtInt(s.battles ? s.damage_dealt / s.battles : 0),
      sub: `всього ${fmtInt(s.damage_dealt)}`,
    },
  ].map((c) => `
    <div class="stat-card ${c.tone || ''}">
      <div class="stat-label">${esc(c.label)}</div>
      <div class="stat-value">${esc(c.value)}</div>
      <div class="stat-sub" title="${esc(c.sub)}">${esc(c.sub)}</div>
    </div>`).join('');
}

function sortValue(t, key) {
  const s = t.all || {};
  const v = t.info || {};
  switch (key) {
    case 'name': return String(v.name || '\uffff').toLowerCase();
    case 'tier': return Number(v.tier) || 0;
    case 'battles': return Number(s.battles) || 0;
    case 'winrate': return s.battles ? (Number(s.wins) || 0) / s.battles : 0;
    case 'damage': return s.battles ? (Number(s.damage_dealt) || 0) / s.battles : 0;
    case 'mark': return Number(t.mark_of_mastery) || 0;
    default: return 0;
  }
}

function sortedTanks(tanks, vehicles) {
  const rows = tanks
    .map((t) => ({ ...t, info: vehicles[String(t.tank_id)] }))
    .filter((t) => (t.all?.battles || 0) > 0);

  const { key, dir } = tankSort;
  rows.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    let result;
    if (typeof av === 'string') result = av.localeCompare(bv, 'uk');
    else result = av - bv;
    if (result === 0) result = sortValue(a, 'name').localeCompare(sortValue(b, 'name'), 'uk');
    return dir === 'asc' ? result : -result;
  });
  return rows;
}

function sortHeader(key, label, extraClass = '') {
  const active = tankSort.key === key;
  const arrow = active ? (tankSort.dir === 'asc' ? '▲' : '▼') : '↕';
  return `<th class="${extraClass}"><button class="sort-btn ${active ? 'active' : ''}"
    data-sort="${key}" type="button">${label}<span class="sort-arrow">${arrow}</span></button></th>`;
}

function tanksSection(tanks, vehicles) {
  const rowsAll = sortedTanks(tanks, vehicles);
  const visible = showAllTanks ? rowsAll : rowsAll.slice(0, 8);

  const rows = visible.map((t) => {
    const v = t.info || {};
    const s = t.all || {};
    const img = v.images?.preview || '';
    const pips = Array.from({ length: 4 }, (_, i) => `<i class="${i < (t.mark_of_mastery || 0) ? 'on' : ''}"></i>`).join('');
    return `
      <tr>
        <td>
          <div class="tank-cell">
            ${img ? `<img class="tank-img" src="${esc(img)}" alt="" loading="lazy">` : ''}
            <div>
              <div class="tank-name">${esc(v.name || `Tank #${t.tank_id}`)}</div>
              <div class="tank-meta">${classIcon(v.type)}${esc(v.nation || '')}</div>
            </div>
          </div>
        </td>
        <td class="num">${esc(v.tier ?? '—')}</td>
        <td class="num">${fmtInt(s.battles)}</td>
        <td class="num">${pct(s.wins, s.battles)}</td>
        <td class="num col-hide">${fmtInt(s.battles ? s.damage_dealt / s.battles : 0)}</td>
        <td class="num"><span class="mastery-pips" title="Знак майстерності: ${fmtInt(t.mark_of_mastery)} / 4">${pips}</span></td>
      </tr>`;
  }).join('');

  const more = rowsAll.length > 8
    ? `<button class="more-btn" id="toggle-all-tanks" type="button">${showAllTanks ? 'Згорнути' : `Показати всі (${rowsAll.length})`}</button>`
    : '';

  return `
    <div id="tanks-section">
      <div class="section-head">
        <div class="section-title">Техніка</div>
        <div class="section-hint">${fmtInt(rowsAll.length)} машин · натисніть на заголовок для сортування</div>
      </div>
      ${rowsAll.length ? `
        <div class="tank-panel">
          <table class="tank-table">
            <thead><tr>
              ${sortHeader('name', 'Машина')}
              ${sortHeader('tier', 'Рівень', 'num')}
              ${sortHeader('battles', 'Боїв', 'num')}
              ${sortHeader('winrate', 'Перемог', 'num')}
              ${sortHeader('damage', 'Шкода / бій', 'num col-hide')}
              ${sortHeader('mark', 'Знак', 'num')}
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>${more}` : emptyState({ glyph: '▤', title: 'Немає боїв на техніці', text: 'Після перших боїв тут з\'явиться список машин.' })}
      <div class="tank-note">
        Відмітки на стволі: <b>1</b> — топ 35%, <b>2</b> — топ 15%, <b>3</b> — топ 5% гравців
        за середнім Gun Mark XP за останні 50 боїв (потрібно 5 000 боїв).
        Точні числові пороги по кожній машині API Blitz не віддає.
      </div>
    </div>`;
}

function bindTankControls(view, tanks, vehicles) {
  const section = view.querySelector('#tanks-section');
  if (!section) return;

  const redraw = () => {
    section.innerHTML = tanksSection(tanks, vehicles);
    bindTankControls(view, tanks, vehicles);
  };

  section.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (tankSort.key === key) tankSort.dir = tankSort.dir === 'asc' ? 'desc' : 'asc';
      else tankSort = { key, dir: key === 'name' ? 'asc' : 'desc' };
      redraw();
    });
  });

  section.querySelector('#toggle-all-tanks')?.addEventListener('click', () => {
    showAllTanks = !showAllTanks;
    redraw();
  });
}

/** Повний рендер вкладки «Профіль». */
export async function renderProfile(view, ctx) {
  if (!ctx.player) {
    view.innerHTML = emptyState({
      glyph: '⌖',
      title: 'Оберіть гравця',
      text: 'Введіть нікнейм у рядок пошуку — ми знайдемо акаунт у регіоні EU.',
      action: '<button class="btn-primary" id="empty-search" type="button">Знайти демо-гравця</button>',
    });
    view.querySelector('#empty-search')?.addEventListener('click', () => ctx.loadPlayer(DEFAULT_NICKNAME));
    return;
  }

  view.innerHTML = `<div class="stats-grid">${skeletons(3)}</div>`;

  try {
    const id = ctx.player.account_id;
    const [info, tanks, vehicles] = await Promise.all([
      api.accountInfo(id),
      api.tankStats(id),
      api.vehicles(),
    ]);
    if (!info) throw new Error('Акаунт не знайдено');

    view.innerHTML = hero(info)
      + `<div class="section-head"><div class="section-title">Статистика</div><div class="section-hint">Накопичувальні дані акаунта · EU</div></div>`
      + `<div class="stats-grid">${statsGrid(info.statistics?.all || {})}</div>`
      + tanksSection(tanks, vehicles);

    bindTankControls(view, tanks, vehicles);
  } catch (err) {
    view.innerHTML = emptyState({
      glyph: '!', title: 'Не вдалося завантажити профіль',
      text: err.message || 'Спробуйте ще раз пізніше.',
      action: '<button class="btn-ghost" id="retry-profile" type="button">Повторити</button>',
    });
    view.querySelector('#retry-profile')?.addEventListener('click', () => renderProfile(view, ctx));
    toast(err.message || 'Помилка завантаження профілю', 'error');
  }
}
