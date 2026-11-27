'use strict';

import { APP_ID, API_BASE, TANK_NAME_OVERRIDES } from './config.js';

let vehiclesCache = null;

/** Універсальний виклик Wargaming Blitz API (регіон EU). */
async function request(method, params = {}) {
  const url = new URL(`${API_BASE}/${method}/`);
  url.searchParams.set('application_id', APP_ID);
  url.searchParams.set('language', 'en');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    throw new Error('Немає з\'єднання з API Wargaming. Перевірте інтернет.');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} від API`);

  const json = await response.json();
  if (json.status !== 'ok') {
    throw new Error(json.meta?.message || `Помилка API (${json.meta?.code ?? '?'})`);
  }
  return json.data;
}

function firstOf(data) {
  if (!data) return null;
  const key = Object.keys(data)[0];
  return key ? data[key] : null;
}

export const api = {
  /** Пошук гравця за початком нікнейму (мінімум 3 символи). */
  async search(nickname, limit = 8) {
    if (!nickname || nickname.trim().length < 3) return [];
    const data = await request('account/list', { search: nickname.trim(), limit, type: 'startswith' });
    return Array.isArray(data) ? data : [];
  },

  /** Знаходимо точний нікнейм або беремо першого знайденого. */
  async findPlayer(nickname) {
    const list = await this.search(nickname, 20);
    if (!list.length) return null;
    const needle = nickname.trim().toLowerCase();
    return list.find((p) => p.nickname.toLowerCase() === needle) || list[0];
  },

  async accountInfo(accountId) {
    return firstOf(await request('account/info', { account_id: accountId }));
  },

  /** Уся техніка гравця з максимальним рангом майстерності. */
  async tankStats(accountId) {
    return firstOf(await request('tanks/stats', { account_id: accountId })) || [];
  },

  /** Довідник машин (назви, рівні, іконки). Кешуємо в пам'яті. */
  async vehicles() {
    if (!vehiclesCache) {
      const dict = await request('encyclopedia/vehicles');
      for (const [id, name] of Object.entries(TANK_NAME_OVERRIDES)) {
        dict[id] = { ...(dict[id] || {}), name };
      }
      vehiclesCache = dict;
    }
    return vehiclesCache;
  },
};
