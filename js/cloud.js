'use strict';

// Синхронізація сесій через Supabase — підхід взято з mycinema-web:
// ті самі проєкт/ключ, таблиця user_library і Authorization через supabase-js.

const SUPABASE_URL = 'https://ssvfsjnzbrgvnknixejf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdmZzam56YnJndm5rbml4ZWpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1OTQ3MjksImV4cCI6MjExMDE3MDcyOX0.riSxxrcFozFlSQbjdFC8ZYOccjSeFv89HV2yIVzJBeE';
const PREFIX = 'wotb.session.';
const ACTIVE_KEY = 'wotb.active';

export const cloud = {
  client: null,
  user: null,
  ready: false,
  error: null,
  listeners: new Set(),
  _pushTimer: null,

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit(kind = 'state') {
    this.listeners.forEach((fn) => { try { fn(kind, this); } catch { /* ignore */ } });
  },

  async init() {
    if (this.client) return;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      this.client = mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
        },
      });
      const { data } = await this.client.auth.getUser();
      this.user = data?.user || null;
      this.client.auth.onAuthStateChange((event, session) => {
        this.user = session?.user || null;
        this.emit(event === 'SIGNED_IN' || event === 'SIGNED_OUT' ? 'auth' : 'state');
      });
    } catch (err) {
      this.error = err;
    }
    this.ready = true;
    this.emit(this.user ? 'auth' : 'ready');
  },

  isOn() { return !!(this.client && this.user); },

  async login(email, password) {
    this._ensure();
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async register(email, password) {
    this._ensure();
    const { error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
  },

  async logout() {
    this._ensure();
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.emit('auth');
  },

  /** Дістаємо свої сесії з user_library (ключаємо префіксом wotb.). */
  async pull() {
    if (!this.isOn()) return null;
    const uid = this.user.id;
    const { data: rows, error } = await this.client
      .from('user_library').select('item_key,user_data')
      .eq('user_id', uid).like('item_key', `${PREFIX}%`);
    if (error) throw error;

    const { data: activeRows, error: err2 } = await this.client
      .from('user_library').select('item_key,user_data')
      .eq('user_id', uid).eq('item_key', ACTIVE_KEY).maybeSingle();
    if (err2) throw err2;

    return {
      history: (rows || []).map((r) => r.user_data).filter(Boolean),
      active: activeRows?.user_data || null,
    };
  },

  /** Debounced upsert — не дергаємо хмару на кожен дрібний чин. */
  push(history, active) {
    if (!this.isOn()) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this._pushNow(history, active).catch((err) => console.warn('[wotb cloud push]', err));
    }, 700);
  },

  async pushNow(history, active) {
    if (!this.isOn()) return;
    await this._pushNow(history, active);
  },

  async _pushNow(history, active) {
    const uid = this.user.id;
    const rows = (history || []).map((s) => ({
      user_id: uid, item_key: PREFIX + s.id, user_data: s,
    }));
    if (active) rows.push({ user_id: uid, item_key: ACTIVE_KEY, user_data: active });
    if (rows.length) {
      const { error } = await this.client
        .from('user_library').upsert(rows, { onConflict: 'user_id,item_key' });
      if (error) throw error;
    }
    if (!active) await this.deleteActive();
  },

  async deleteSession(id) {
    if (!this.isOn()) return;
    const { error } = await this.client.from('user_library')
      .delete().eq('user_id', this.user.id).eq('item_key', PREFIX + id);
    if (error) throw error;
  },

  async deleteActive() {
    if (!this.isOn()) return;
    const { error } = await this.client.from('user_library')
      .delete().eq('user_id', this.user.id).eq('item_key', ACTIVE_KEY);
    if (error) throw error;
  },

  async clearSessions() {
    if (!this.isOn()) return;
    const { error } = await this.client.from('user_library')
      .delete().eq('user_id', this.user.id).like('item_key', `${PREFIX}%`);
    if (error) throw error;
    await this.deleteActive();
  },

  _ensure() {
    if (!this.client) throw new Error('Хмарний клієнт ще не завантажено');
  },
};
