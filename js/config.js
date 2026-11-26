'use strict';

export const APP_ID = 'd3ed3ce2583e4a355955f3e72c186599';
export const REGION = 'eu';
export const API_BASE = `https://api.wotblitz.${REGION}/wotb`;

// Статичний демо-акаунт з великою кількістю боїв — щоб макет виглядав наповненим.
export const DEFAULT_NICKNAME = 'TANK00000000000010203';
export const DEMO_NICKNAMES = ['InsaNeCool', DEFAULT_NICKNAME];

export const LS = {
  player: 'mywotb.player.v1',
  sessions: 'mywotb.sessions.v1',
  active: 'mywotb.active.v1',
};

// Поля, які Ми свідомо НЕ беремо / не рахуємо: WN7, WN8, WTR.
export const STAT_FIELDS = [
  'battles', 'wins', 'losses', 'survived_battles', 'win_and_survived',
  'damage_dealt', 'damage_received', 'frags', 'frags8p', 'xp',
  'hits', 'shots', 'spotted', 'capture_points', 'dropped_capture_points',
  'max_xp', 'max_frags',
];

export const LIVE_REFRESH_MS = 60000;
