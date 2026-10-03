// =====================================================================
// AuthManager — Supabase Auth（username → email 映射）、Session 管理、登入日誌
// * 管理員身分一律以後端 get_my_state().profile.role 為準，前端只用來顯示按鈕。
// * 不記錄密碼與 token。
// =====================================================================
import { CONFIG } from '../config.js';
import { supabase, ApiError, NetworkError } from '../net/supabaseClient.js';

const SESSION_KEY = 'feedpet.session.v1';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function authError(code) { const e = new Error(code); e.code = code; return e; }

export class AuthManager {
  constructor(client = supabase) {
    this.client = client;
    this.session = null;        // { access_token, refresh_token, expires_at, user_id, username }
    this.profile = null;        // 來自 get_my_state
    this.listeners = new Set();
    this._refreshTimer = null;
    this._refreshing = null;

    client.tokenProvider = () => this.getAccessToken();
    client.onUnauthorized = () => this._refresh().then(() => true).catch(() => false);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type) { for (const fn of this.listeners) { try { fn(type, this); } catch (e) { console.error(e); } } }

  get isLoggedIn() { return !!this.session; }
  get isAdmin() { return this.profile?.role === 'admin'; }   // 只用於 UI；權限由後端 RPC 驗證

  static normalizeUsername(u) { return String(u || '').trim().toLowerCase(); }
  static emailFor(username) { return `${username}@${CONFIG.EMAIL_DOMAIN}`; }

  // ---------------- Register ----------------
  async register(usernameRaw, password, displayName) {
    const username = AuthManager.normalizeUsername(usernameRaw);
    if (!USERNAME_RE.test(username)) throw authError('INVALID_USERNAME');
    if (typeof password !== 'string' || password.length < 8) throw authError('WEAK_PASSWORD');
    const name = String(displayName || '').trim().slice(0, 20).replace(/[<>\u0000-\u001f]/g, '') || username;

    let data;
    try {
      data = await this.client.authSignUp(AuthManager.emailFor(username), password, { username, display_name: name });
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('already') || e.code === 'user_already_exists') throw authError('USERNAME_TAKEN');
      if (msg.includes('password')) throw authError('WEAK_PASSWORD');
      if (msg.includes('database error')) throw authError('USERNAME_TAKEN');
      throw e;
    }
    if (!data || !data.access_token) throw authError('EMAIL_CONFIRM_ON');
    await this._acceptSession(data, username);
    await this._afterLogin();
    return this.profile;
  }

  // ---------------- Login ----------------
  async login(usernameRaw, password) {
    const username = AuthManager.normalizeUsername(usernameRaw);
    if (!USERNAME_RE.test(username) || !password) {
      this._logAnon(username, 'LOGIN_FAILED');
      throw authError('INVALID_LOGIN');
    }
    let data;
    try {
      data = await this.client.authSignIn(AuthManager.emailFor(username), password);
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      if (e instanceof ApiError && (e.status === 400 || e.status === 401)) {
        this._logAnon(username, 'LOGIN_FAILED');
        throw authError('INVALID_LOGIN');
      }
      throw e;
    }
    await this._acceptSession(data, username);
    await this._afterLogin();
    return this.profile;
  }

  async _afterLogin() {
    await this.client.rpc('log_login', { p_event: 'LOGIN_SUCCESS', p_user_agent: navigator.userAgent.slice(0, 200) })
      .catch(() => {});                       // 日誌失敗不影響登入
    await this.loadState();
    this._emit('login');
  }

  // 由後端取得完整狀態（含真實 role）
  async loadState() {
    const state = await this.client.rpc('get_my_state');
    this.profile = state.profile;
    this._emit('state');
    return state;
  }

  // ---------------- Restore / Refresh ----------------
  async restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { saved = null; }
    if (!saved || !saved.refresh_token) return false;
    this.session = saved;
    try {
      if (Date.now() / 1000 > saved.expires_at - 60) await this._refresh();
      else this._scheduleRefresh();
      await this.loadState();
      this._emit('login');
      return true;
    } catch (e) {
      if (e instanceof NetworkError) throw e;   // 交給 UI 顯示 RETRY，不清除 session
      return false;
    }
  }

  async getAccessToken() {
    if (!this.session) return null;
    if (Date.now() / 1000 > this.session.expires_at - 30) {
      try { await this._refresh(); } catch { return null; }
    }
    return this.session?.access_token || null;
  }

  _refresh() {
    if (this._refreshing) return this._refreshing;
    const username = this.session?.username;
    this._refreshing = (async () => {
      try {
        const data = await this.client.authRefresh(this.session.refresh_token);
        await this._acceptSession(data, username);
      } catch (e) {
        if (!(e instanceof NetworkError)) {
          this._logAnon(username, 'SESSION_EXPIRED');
          this._clear();
          this._emit('expired');
        }
        throw e;
      } finally {
        this._refreshing = null;
      }
    })();
    return this._refreshing;
  }

  async _acceptSession(data, username) {
    const expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      user_id: data.user?.id || this.session?.user_id,
      username,
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch { /* private mode */ }
    this._scheduleRefresh();
  }

  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    if (!this.session) return;
    const ms = Math.max(5000, (this.session.expires_at - 90) * 1000 - Date.now());
    this._refreshTimer = setTimeout(() => this._refresh().catch(() => {}), ms);
  }

  // ---------------- Logout ----------------
  async logout() {
    if (!this.session) return;
    const token = this.session.access_token;
    await this.client.rpc('log_login', { p_event: 'LOGOUT', p_user_agent: navigator.userAgent.slice(0, 200) }).catch(() => {});
    await this.client.authSignOut(token).catch(() => {});
    this._clear();
    this._emit('logout');
  }

  _clear() {
    clearTimeout(this._refreshTimer);
    this.session = null;
    this.profile = null;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  _logAnon(username, event) {
    this.client.rpc('log_auth_event_anon',
      { p_username: username || '', p_event: event, p_user_agent: navigator.userAgent.slice(0, 200) },
      { useAuth: false }).catch(() => {});
  }
}

export const auth = new AuthManager();
