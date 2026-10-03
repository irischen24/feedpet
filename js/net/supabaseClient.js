// =====================================================================
// SupabaseClient — 直接呼叫 Supabase REST / Auth API（不依賴 SDK）
// 不記錄、不輸出任何 token 或 Authorization header。
// =====================================================================
import { CONFIG } from '../config.js';

export class NetworkError extends Error {
  constructor(message = 'NETWORK') { super(message); this.name = 'NetworkError'; this.code = 'NETWORK'; }
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || `HTTP_${status}`;
  }
}

// 後端 raise exception 'XXX' → 取出大寫錯誤碼
function extractCode(body) {
  const msg = (body && (body.message || body.msg || body.error_description || body.error)) || '';
  const m = /^([A-Z][A-Z0-9_]{2,})/.exec(msg);
  return { code: m ? m[1] : (body && (body.error_code || body.code)) || null, message: msg };
}

export class SupabaseClient {
  constructor({ url = CONFIG.SUPABASE_URL, anonKey = CONFIG.SUPABASE_ANON_KEY } = {}) {
    this.url = url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    this.anonKey = anonKey;
    this.tokenProvider = null;     // async () => access_token | null（由 AuthManager 設定）
    this.onUnauthorized = null;    // async () => boolean（嘗試 refresh，成功回 true）
    this.lastError = null;         // DEBUG 顯示用：{ path, code, at }
  }

  _noteError(path, code) {
    this.lastError = { path: path.split('?')[0], code, at: new Date().toLocaleTimeString('zh-TW', { hour12: false }) };
  }

  async _fetch(path, { method = 'GET', body, headers = {}, useAuth = true, keepalive = false, _retried = false } = {}) {
    const h = { apikey: this.anonKey, 'Content-Type': 'application/json', ...headers };
    const token = useAuth && this.tokenProvider ? await this.tokenProvider() : null;
    h.Authorization = `Bearer ${token || this.anonKey}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(this.url + path, {
        method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal, keepalive, credentials: 'omit', cache: 'no-store',
      });
    } catch (_e) {
      this._noteError(path, 'NETWORK');
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }

    if (res.status === 401 && token && !_retried && this.onUnauthorized) {
      if (await this.onUnauthorized()) {
        return this._fetch(path, { method, body, headers, useAuth, keepalive, _retried: true });
      }
    }
    if (!res.ok) {
      const { code, message } = extractCode(typeof data === 'object' ? data : { message: String(data || '') });
      this._noteError(path, code || res.status);
      throw new ApiError(res.status, code, message);
    }
    return data;
  }

  // ---------- Auth ----------
  authSignUp(email, password, metadata) {
    return this._fetch('/auth/v1/signup', { method: 'POST', useAuth: false, body: { email, password, data: metadata } });
  }
  authSignIn(email, password) {
    return this._fetch('/auth/v1/token?grant_type=password', { method: 'POST', useAuth: false, body: { email, password } });
  }
  authRefresh(refreshToken) {
    return this._fetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST', useAuth: false, body: { refresh_token: refreshToken } });
  }
  authSignOut(accessToken) {
    return this._fetch('/auth/v1/logout', {
      method: 'POST', useAuth: false, headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  // ---------- Database ----------
  rpc(name, args = {}, { useAuth = true, keepalive = false } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Invalid RPC name');
    return this._fetch(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, useAuth, keepalive });
  }

  // 簡易查詢：select('items', { select: 'code,name', order: 'sort.asc', limit: 50, filters: { type: 'eq.food' } })
  select(table, { select = '*', order, limit, offset, filters = {} } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid table name');
    const p = new URLSearchParams({ select });
    if (order) p.set('order', order);
    if (limit != null) p.set('limit', String(limit));
    if (offset != null) p.set('offset', String(offset));
    for (const [k, v] of Object.entries(filters)) p.set(k, v);   // URLSearchParams 會自動編碼，避免注入
    return this._fetch(`/rest/v1/${table}?${p.toString()}`);
  }

  insert(table, row) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid table name');
    return this._fetch(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } });
  }

  // 取得總筆數（PostgREST count=exact，透過 Content-Range）
  async count(table, filters = {}) {
    const p = new URLSearchParams({ select: '*', limit: '1' });
    for (const [k, v] of Object.entries(filters)) p.set(k, v);
    const token = this.tokenProvider ? await this.tokenProvider() : null;
    try {
      const res = await fetch(`${this.url}/rest/v1/${table}?${p}`, {
        method: 'HEAD', headers: { apikey: this.anonKey, Authorization: `Bearer ${token || this.anonKey}`, Prefer: 'count=exact' },
        credentials: 'omit', cache: 'no-store',
      });
      const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  update(table, filters, patch) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid table name');
    const p = new URLSearchParams(filters);
    return this._fetch(`/rest/v1/${table}?${p.toString()}`, {
      method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' },
    });
  }
}

export const supabase = new SupabaseClient();
