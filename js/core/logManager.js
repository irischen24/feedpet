// =====================================================================
// LogManager — 只記錄有意義的遊戲事件（不記錄每一幀 / pointermove）
// * 批次送出（每 10 秒，或佇列滿 20 筆，或重要事件立即送）
// * 離線時暫存，恢復連線後補送
// * 這些是「客戶端宣稱」的稽核紀錄；獎勵永遠由後端 RPC 計算，不依賴日誌
// =====================================================================
import { CONFIG } from '../config.js';
import { supabase, NetworkError } from '../net/supabaseClient.js';

const QUEUE_KEY = 'feedpet.logQueue.v1';
export const CLIENT_ACTIONS = new Set([
  'ROOM_ENTER', 'ROOM_EXIT', 'ITEM_PICKUP', 'ITEM_USE', 'SKILL_USE', 'MONSTER_ATTACK',
  'MONSTER_DEFEATED', 'PLAYER_DAMAGE', 'PLAYER_DEATH', 'LEVEL_COMPLETE',
  'BATTLE_PAUSE', 'BATTLE_RESUME', 'UI_OPEN', 'SETTINGS_CHANGE', 'CLIENT_ERROR',
]);
const IMMEDIATE = new Set(['PLAYER_DEATH', 'LEVEL_COMPLETE', 'CLIENT_ERROR']);

export class LogManager {
  constructor(authManager, client = supabase) {
    this.auth = authManager;
    this.client = client;
    this.queue = this._load();
    this.backoffMs = 0;
    this.lastError = null;
    this._flushing = false;
    this._timer = setInterval(() => this.flush(), CONFIG.LOG_FLUSH_INTERVAL_MS);
    window.addEventListener('online', () => { this.backoffMs = 0; this.flush(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush({ keepalive: true });
    });
  }

  log(action, { targetType = null, targetId = null, sessionId = null, metadata = {} } = {}) {
    if (!CLIENT_ACTIONS.has(action)) {
      if (CONFIG.DEBUG) console.warn('[LogManager] action not allowed:', action);
      return;
    }
    this.queue.push({
      action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId).slice(0, 80),
      session_id: sessionId,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      client_ts: new Date().toISOString(),
    });
    if (this.queue.length > CONFIG.LOG_QUEUE_MAX) this.queue.splice(0, this.queue.length - CONFIG.LOG_QUEUE_MAX);
    this._save();
    if (IMMEDIATE.has(action) || this.queue.length >= 20) this.flush();
  }

  async flush({ keepalive = false } = {}) {
    if (this._flushing || !this.queue.length || !this.auth.isLoggedIn) return;
    if (this.backoffMs && !keepalive) {
      if (Date.now() < this._nextTry) return;
    }
    this._flushing = true;
    const batch = this.queue.slice(0, 50).map(({ client_ts, ...e }) => ({
      ...e, metadata: { ...e.metadata, client_ts },
    }));
    try {
      await this.client.rpc('log_events', { p_events: batch }, { keepalive });
      this.queue.splice(0, batch.length);
      this._save();
      this.backoffMs = 0;
      this.lastError = null;
    } catch (e) {
      this.lastError = e;
      if (e instanceof NetworkError) {
        this.backoffMs = Math.min(60000, (this.backoffMs || 2000) * 2);
        this._nextTry = Date.now() + this.backoffMs;
      } else {
        this.queue.splice(0, batch.length);   // 伺服器拒絕的批次直接丟棄，避免無限重送
        this._save();
      }
    } finally {
      this._flushing = false;
    }
  }

  _load() {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(q) ? q.slice(-CONFIG.LOG_QUEUE_MAX) : [];
    } catch { return []; }
  }
  _save() { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue)); } catch { /* ignore */ } }
}
