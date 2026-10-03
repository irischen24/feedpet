// =====================================================================
// DataStore — 伺服器狀態的前端快取（顯示用）。
// 數值一律以後端回傳為準；前端不自行修改分數、魚乾或體力。
// =====================================================================
import { supabase } from '../net/supabaseClient.js';

const SHOWN_KEY = 'feedpet.shownExpired.v1';

export class DataStore {
  constructor(auth) {
    this.auth = auth;
    this.state = null;
    this.config = {};
    this.characterTypes = {};
    this.monsters = {};
    this.serverOffsetMs = 0;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  async loadCatalog() {
    const [cfg, types, monsters] = await Promise.all([
      supabase.select('game_config', { select: 'key,value' }),
      supabase.select('character_types', { select: '*', order: 'sort.asc' }),
      supabase.select('monsters', { select: '*' }),
    ]);
    this.monsters = Object.fromEntries(monsters.map((m) => [m.code, m]));
    this.config = Object.fromEntries(cfg.map((r) => [r.key, r.value]));
    this.characterTypes = Object.fromEntries(types.map((t) => [t.code, t]));
  }

  async refresh() {
    const state = await this.auth.loadState();
    this.setState(state);
    return state;
  }

  setState(state) {
    this.state = state;
    this.serverOffsetMs = Date.parse(state.server_time) - Date.now();
    this._emit();
  }

  now() { return Date.now() + this.serverOffsetMs; }
  get adoptions() { return this.state?.adoptions || []; }
  get wallet() { return this.state?.wallet || { fish: 0, bone: 0 }; }
  text(key) { return typeof this.config[key] === 'string' ? this.config[key] : ''; }

  // 目前選擇的貓（只存在本機，是顯示偏好，不影響權限）
  get selectedKey() { return `feedpet.selected.${this.state?.profile?.id}`; }
  get selected() {
    const list = this.adoptions;
    if (!list.length) return null;
    let id = null;
    try { id = localStorage.getItem(this.selectedKey); } catch { /* ignore */ }
    return list.find((a) => a.id === id) || list[0];
  }
  select(id) {
    try { localStorage.setItem(this.selectedKey, id); } catch { /* ignore */ }
    this._emit();
  }
  cycleSelected() {
    const list = this.adoptions;
    if (list.length < 2) return this.selected;
    const i = list.findIndex((a) => a.id === this.selected.id);
    const next = list[(i + 1) % list.length];
    this.select(next.id);
    return next;
  }

  // 尚未告知玩家的「認養已結束」紀錄
  takeUnseenEnded() {
    let shown = [];
    try { shown = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]'); } catch { shown = []; }
    const fresh = (this.state?.recently_ended || []).filter((e) => e.end_reason === 'NOT_FED' && !shown.includes(e.id));
    if (fresh.length) {
      try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, ...fresh.map((e) => e.id)].slice(-50))); } catch { /* ignore */ }
    }
    return fresh;
  }

  // 依 Excel 規則挑出貓咪要說的話（優先序：生病 > 剩 6 小時 > 48 小時 > 低體力）
  ambientLine(a = this.selected) {
    if (!a) return null;
    if (a.disease) return `我得了${a.disease.name}，需要到商店買藥照顧我。`;
    if (a.reminder === '6H') return this.text('text_remind_6h');
    if (a.reminder === '48H') return this.text('text_remind_48h');
    if (a.low_stamina) return this.text('text_low_stamina');
    return null;
  }
}
