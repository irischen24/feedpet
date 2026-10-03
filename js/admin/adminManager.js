// =====================================================================
// AdminManager — ADMIN PANEL
//   * 前端只用 role 決定是否顯示入口；真正的權限由後端 is_admin()、RLS 驗證
//   * 每個寫入都走 admin_* RPC（同一 transaction 寫 admin_actions），
//     或對遊戲定義表 PATCH（由資料庫 trigger 自動寫 Audit Log）
//   * 所有資料一律 textContent 顯示（防 XSS）
// =====================================================================
import { supabase, NetworkError } from '../net/supabaseClient.js';
import { el } from '../ui/uiManager.js';
import { messageFor } from '../core/errors.js';

const $ = (id) => document.getElementById(id);
const PAGE = 50;
const TABS = [
  ['overview', '總覽'], ['players', '玩家'], ['sessions', '遊戲紀錄'], ['logins', '登入日誌'],
  ['ops', '操作日誌'], ['audit', 'Audit Log'], ['config', '遊戲設定'], ['animals', '認養動物'], ['shelters', '收容所'],
];
const DISEASES = [['', '健康'], ['tick', '壁蝨'], ['flea', '跳蚤'], ['ear_mite', '耳疥蟲'], ['heartworm', '心絲蟲']];
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
const short = (id) => (id ? String(id).slice(0, 8) : '—');
const clean = (q) => String(q || '').replace(/[*%,()]/g, '').trim();   // PostgREST 篩選值不允許特殊字元

export class AdminManager {
  constructor(app) {
    this.app = app;
    this.tab = 'overview';
    this.offset = 0;
    this.filters = {};
    this.names = new Map();          // user_id → username（顯示用）
    this.items = [];
  }

  async open() {
    this.app.ui.show('admin');
    $('adminWho').textContent = `管理員：${this.app.store.state?.profile?.display_name || ''}`;
    $('adminTabs').replaceChildren(...TABS.map(([k, v]) =>
      el('button', { class: `tab${k === this.tab ? ' active' : ''}`, 'data-tab': k, text: v, onclick: () => this.go(k) })));
    this.app.logs.log('UI_OPEN', { targetType: 'screen', targetId: 'admin' });
    if (!this.items.length) this.items = await supabase.select('items', { select: 'code,name,type', order: 'sort.asc' }).catch(() => []);
    this.go(this.tab);
  }

  go(tab, keepPage = false) {
    this.tab = tab;
    if (!keepPage) { this.offset = 0; this.filters = {}; }
    document.querySelectorAll('#adminTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    this.closeDrawer();
    this.render();
  }

  async render() {
    const body = $('adminBody');
    body.replaceChildren(el('p', { class: 'hint', text: '讀取中…' }));
    try {
      const nodes = await this[`_${this.tab}`]();
      body.replaceChildren(...[].concat(nodes).filter(Boolean));
    } catch (e) { this._err(e, () => this.render()); }
  }

  _err(e, retry) {
    if (e instanceof NetworkError) { this.app.ui.showNetworkError(retry); return; }
    const msg = e.code === 'FORBIDDEN' || e.status === 401 || e.status === 403 ? '沒有管理員權限（由伺服器拒絕）。' : messageFor(e);
    this.app.ui.toast(msg, 4000);
    $('adminBody').replaceChildren(el('p', { class: 'warn', text: msg }));
  }

  // ---------- 共用：表格、分頁、篩選 ----------
  table(cols, rows, onRow) {
    if (!rows.length) return el('p', { class: 'hint', text: '沒有資料。' });
    return el('div', { class: 'admin-table-wrap' }, [el('table', { class: 'admin-table' }, [
      el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { text: c[0] })))]),
      el('tbody', {}, rows.map((r) => el('tr', onRow ? { class: 'clickable', onclick: () => onRow(r) } : {},
        cols.map((c) => { const v = c[1](r); return el('td', { class: c[2] || '' }, [v instanceof Node ? v : document.createTextNode(v ?? '—')]); })))),
    ])]);
  }

  pager(count) {
    const prev = el('button', { class: 'btn small', text: '上一頁', onclick: () => { this.offset = Math.max(0, this.offset - PAGE); this.render(); } });
    const next = el('button', { class: 'btn small', text: '下一頁', onclick: () => { this.offset += PAGE; this.render(); } });
    if (this.offset === 0) prev.disabled = true;
    if (count < PAGE) next.disabled = true;
    return el('div', { class: 'row pager' }, [prev, el('span', { text: `第 ${this.offset / PAGE + 1} 頁` }), next]);
  }

  filterBar(fields) {
    const inputs = fields.map(([key, label, options]) => {
      const input = options
        ? el('select', {}, options.map(([v, t]) => el('option', { value: v, text: t })))
        : el('input', { placeholder: label, maxlength: '40' });
      input.value = this.filters[key] || '';
      input.dataset.key = key;
      return el('label', { class: 'filter' }, [document.createTextNode(label), input]);
    });
    const apply = () => { for (const i of inputs) { const f = i.querySelector('input,select'); this.filters[f.dataset.key] = f.value; } this.offset = 0; this.render(); };
    inputs.forEach((l) => l.querySelector('input,select').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); }));
    return el('div', { class: 'row filters' }, [...inputs, el('button', { class: 'btn small primary', text: '篩選', onclick: apply })]);
  }

  async loadNames(ids) {
    const need = [...new Set(ids.filter((i) => i && !this.names.has(i)))];
    if (!need.length) return;
    const rows = await supabase.select('profiles', { select: 'id,username', filters: { id: `in.(${need.join(',')})` } });
    for (const r of rows) this.names.set(r.id, r.username);
  }
  who(id) { return id ? (this.names.get(id) || short(id)) : '—'; }

  // ================= 總覽 =================
  async _overview() {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const [players, active, sessions, wins, fails, logins] = await Promise.all([
      supabase.count('profiles'),
      supabase.count('adoptions', { status: 'eq.ACTIVE' }),
      supabase.count('game_sessions', { started_at: `gte.${since}` }),
      supabase.count('game_sessions', { started_at: `gte.${since}`, status: 'eq.COMPLETED' }),
      supabase.count('login_logs', { created_at: `gte.${since}`, event_type: 'eq.LOGIN_FAILED' }),
      supabase.count('login_logs', { created_at: `gte.${since}`, event_type: 'eq.LOGIN_SUCCESS' }),
    ]);
    const card = (label, v, warn) => el('div', { class: `stat${warn ? ' warn-card' : ''}` }, [el('b', { text: v ?? '—' }), document.createTextNode(label)]);
    return [
      el('div', { class: 'stats' }, [card('玩家', players), card('有效認養', active), card('24h 戰鬥', sessions),
        card('24h 勝場', wins), card('24h 登入', logins), card('24h 登入失敗', fails, fails > 20)]),
      el('p', { class: 'hint', text: '登入失敗短時間大量增加時，可到「登入日誌」篩選 LOGIN_FAILED 查看帳號。' }),
    ];
  }

  // ================= 玩家 =================
  async _players() {
    const r = await supabase.rpc('admin_list_players', { p_search: clean(this.filters.q), p_limit: PAGE, p_offset: this.offset });
    return [
      this.filterBar([['q', '帳號或名稱']]),
      el('p', { class: 'hint', text: `共 ${r.total} 位玩家。點一列查看詳細資料與管理操作。` }),
      this.table([
        ['帳號', (p) => p.username], ['名稱', (p) => p.display_name],
        ['身分', (p) => (p.role === 'admin' ? el('span', { class: 'tag admin-tag', text: 'admin' }) : 'user')],
        ['最後登入', (p) => fmt(p.last_login_at)], ['最後活動', (p) => fmt(p.last_active_at)],
        ['魚乾', (p) => p.fish, 'num'], ['最高分', (p) => p.best_score, 'num'], ['戰鬥', (p) => p.total_battles, 'num'],
        ['認養中', (p) => p.active_adoptions, 'num'], ['生病', (p) => (p.sick ? `${p.sick}` : ''), 'num'],
      ], r.rows, (p) => this.openPlayer(p.id)),
      this.pager(r.rows.length),
    ];
  }

  async openPlayer(id) {
    this.openDrawer('讀取中…', [el('p', { text: '讀取中…' })]);
    let d;
    try { d = await supabase.rpc('admin_get_player', { p_user_id: id }); } catch (e) { this.closeDrawer(); this._err(e, () => this.openPlayer(id)); return; }
    const p = d.profile, w = d.wallet || {}, pr = d.progress || {};
    const nodes = [
      el('div', { class: 'kv' }, [
        ['帳號', p.username], ['名稱', p.display_name], ['身分', p.role], ['註冊', fmt(p.created_at)],
        ['最後登入', fmt(p.last_login_at)], ['最後活動', fmt(p.last_active_at)],
        ['魚乾', w.fish], ['骨頭', w.bone], ['最高分', pr.best_score], ['戰鬥 / 勝場', `${pr.total_battles ?? 0} / ${pr.total_wins ?? 0}`],
        ['助養魚乾', pr.total_donated], ['User ID', p.id],
      ].map(([k, v]) => el('div', {}, [el('span', { text: k }), el('b', { text: v ?? '—' })]))),

      el('h3', { text: '發放魚乾／骨頭' }), this._grantCurrencyForm(p),
      el('h3', { text: '發放道具' }), this._grantItemForm(p, d.inventory),
      el('h3', { text: '認養' }),
      ...(d.adoptions.length ? d.adoptions.map((a) => this._adoptionCard(p, a)) : [el('p', { class: 'hint', text: '沒有認養紀錄。' })]),
      el('h3', { text: '帳號' }), this._profileForm(p),
      el('h3', { text: '最近戰鬥' }),
      this.table([['開始', (s) => fmt(s.started_at)], ['戰場', (s) => s.room_code], ['狀態', (s) => s.status],
        ['分數', (s) => s.score, 'num'], ['魚乾', (s) => s.fish_reward, 'num']], d.sessions),
      el('h3', { text: '最近登入' }),
      this.table([['時間', (l) => fmt(l.created_at)], ['事件', (l) => l.event_type], ['裝置', (l) => (l.user_agent || '').slice(0, 40)]], d.logins),
    ];
    this.openDrawer(`玩家：${p.display_name}（${p.username}）`, nodes);
  }

  _reasonInput() { return el('input', { class: 'reason', placeholder: '原因（必填，會寫入 Audit Log）', maxlength: '200' }); }

  async _do(btn, rpc, args, ok, userId) {
    btn.disabled = true;
    try {
      await supabase.rpc(rpc, args);
      this.app.ui.toast(ok);
      if (userId) this.openPlayer(userId);
    } catch (e) {
      btn.disabled = false;
      if (e instanceof NetworkError) this.app.ui.showNetworkError(() => this._do(btn, rpc, args, ok, userId));
      else this.app.ui.toast(e.code === 'FORBIDDEN' ? '沒有管理員權限（由伺服器拒絕）。' : messageFor(e), 4000);
    }
  }

  _grantCurrencyForm(p) {
    const fish = el('input', { type: 'number', value: '50', step: '1' });
    const bone = el('input', { type: 'number', value: '0', step: '1' });
    const reason = this._reasonInput();
    const btn = el('button', { class: 'btn small primary', text: '發放' });
    btn.onclick = () => this._do(btn, 'admin_grant_currency',
      { p_user_id: p.id, p_fish: Number(fish.value) || 0, p_bone: Number(bone.value) || 0, p_reason: reason.value },
      `已發放給 ${p.username}`, p.id);
    return el('div', { class: 'row form' }, [el('label', {}, ['魚乾', fish]), el('label', {}, ['骨頭', bone]), reason, btn,
      el('p', { class: 'hint', text: '輸入負數可以扣除（不會扣到負值）。' })]);
  }

  _grantItemForm(p, inv) {
    const sel = el('select', {}, this.items.filter((i) => i.type !== 'special').map((i) => el('option', { value: i.code, text: `${i.name}（${i.code}）` })));
    const qty = el('input', { type: 'number', value: '1', step: '1' });
    const reason = this._reasonInput();
    const btn = el('button', { class: 'btn small primary', text: '發放' });
    btn.onclick = () => this._do(btn, 'admin_grant_item',
      { p_user_id: p.id, p_item_code: sel.value, p_qty: Number(qty.value) || 0, p_reason: reason.value }, '已更新道具', p.id);
    const have = (inv || []).filter((i) => i.qty > 0).map((i) => `${this.items.find((x) => x.code === i.item_code)?.name || i.item_code} ×${i.qty}`).join('、');
    return el('div', {}, [el('p', { class: 'hint', text: `目前背包：${have || '空'}` }),
      el('div', { class: 'row form' }, [sel, el('label', {}, ['數量', qty]), reason, btn])]);
  }

  _adoptionCard(p, a) {
    const num = (v, min, max) => el('input', { type: 'number', value: String(v), min: String(min), max: String(max), step: '1' });
    const f = { stamina: num(a.stamina, 0, a.max_stamina), trust: num(a.trust, 0, 100), level: num(a.level, 1, 20), exp: num(a.exp, 0, 99999) };
    const dis = el('select', {}, DISEASES.map(([v, t]) => el('option', { value: v, text: t })));
    dis.value = a.disease?.code || '';
    const resetFeed = el('input', { type: 'checkbox' });
    const release = el('input', { type: 'checkbox' });
    const reason = this._reasonInput();
    const btn = el('button', { class: 'btn small primary', text: '更新認養' });
    btn.onclick = () => {
      const patch = {};
      for (const [k, i] of Object.entries(f)) if (Number(i.value) !== a[k]) patch[k] = Number(i.value);
      if ((a.disease?.code || '') !== dis.value) patch.disease_code = dis.value || null;
      if (resetFeed.checked) patch.reset_feed_timer = true;
      if (release.checked) {
        if (!window.confirm(`確定要解除 ${p.username} 對 ${a.animal_name} 的認養？`)) return;
        patch.status = 'RELEASED';
      }
      if (!Object.keys(patch).length) { this.app.ui.toast('沒有變更'); return; }
      this._do(btn, 'admin_update_adoption', { p_adoption_id: a.id, p_patch: patch, p_reason: reason.value }, '已更新認養', p.id);
    };
    const active = a.status === 'ACTIVE';
    return el('div', { class: `card adoption-card${active ? '' : ' ended'}` }, [
      el('strong', { text: `${a.animal_name}（${a.character_name}）・${a.status}${a.end_reason ? `／${a.end_reason}` : ''}` }),
      el('p', { class: 'hint', text: `認養 ${fmt(a.adopted_at)}・上次餵食 ${fmt(a.last_fed_at)}・到期 ${fmt(a.expires_at)}` }),
      active ? el('div', { class: 'row form' }, [
        el('label', {}, [`體力（最大 ${a.max_stamina}）`, f.stamina]), el('label', {}, ['信任', f.trust]),
        el('label', {}, ['等級', f.level]), el('label', {}, ['經驗', f.exp]), el('label', {}, ['疾病', dis]),
        el('label', { class: 'check' }, [resetFeed, document.createTextNode('重設 72 小時計時')]),
        el('label', { class: 'check' }, [release, document.createTextNode('解除認養')]),
        reason, btn]) : el('p', { class: 'hint', text: `Lv.${a.level}・信任 ${a.trust}（已結束，不能修改）` }),
    ]);
  }

  _profileForm(p) {
    const name = el('input', { value: p.display_name, maxlength: '20' });
    const role = el('select', {}, [['user', 'user'], ['admin', 'admin']].map(([v, t]) => el('option', { value: v, text: t })));
    role.value = p.role;
    const reason = this._reasonInput();
    const btn = el('button', { class: 'btn small primary', text: '更新帳號' });
    btn.onclick = () => {
      if (role.value !== p.role && !window.confirm(`確定要把 ${p.username} 的身分改成 ${role.value}？`)) return;
      this._do(btn, 'admin_update_profile', { p_user_id: p.id, p_display_name: name.value, p_role: role.value, p_reason: reason.value }, '已更新帳號', p.id);
    };
    return el('div', { class: 'row form' }, [el('label', {}, ['顯示名稱', name]), el('label', {}, ['身分', role]), reason, btn]);
  }

  // ================= 日誌與紀錄 =================
  async _userFilter() {
    const u = clean(this.filters.user);
    if (!u) return {};
    const rows = await supabase.select('profiles', { select: 'id', filters: { username: `eq.${u.toLowerCase()}` } });
    return { user_id: `eq.${rows[0]?.id || '00000000-0000-0000-0000-000000000000'}` };
  }

  async _sessions() {
    const f = { ...(await this._userFilter()) };
    if (this.filters.status) f.status = `eq.${this.filters.status}`;
    const rows = await supabase.select('game_sessions', {
      select: 'id,user_id,adoption_id,room_code,skill_code,status,started_at,ended_at,score,fish_reward,result',
      order: 'started_at.desc', limit: PAGE, offset: this.offset, filters: f,
    });
    await this.loadNames(rows.map((r) => r.user_id));
    return [
      this.filterBar([['user', '帳號'], ['status', '狀態', [['', '全部'], ['PLAYING', 'PLAYING'], ['COMPLETED', 'COMPLETED'], ['FAILED', 'FAILED'], ['ABANDONED', 'ABANDONED']]]]),
      this.table([
        ['開始', (r) => fmt(r.started_at)], ['玩家', (r) => this.who(r.user_id)], ['戰場', (r) => r.room_code], ['技能', (r) => r.skill_code || ''],
        ['狀態', (r) => r.status], ['分數', (r) => r.score, 'num'], ['魚乾', (r) => r.fish_reward, 'num'],
        ['擊敗', (r) => (r.result?.kills ? Object.values(r.result.kills).reduce((a, b) => a + b, 0) : ''), 'num'],
        ['秒數', (r) => r.result?.elapsed_sec ?? '', 'num'],
      ], rows),
      this.pager(rows.length),
    ];
  }

  async _logins() {
    const f = {};
    const u = clean(this.filters.user);
    if (u) f.username = `eq.${u.toLowerCase()}`;
    if (this.filters.event) f.event_type = `eq.${this.filters.event}`;
    const rows = await supabase.select('login_logs', { order: 'created_at.desc', limit: PAGE, offset: this.offset, filters: f });
    return [
      this.filterBar([['user', '帳號'], ['event', '事件', [['', '全部'], ['LOGIN_SUCCESS', 'LOGIN_SUCCESS'], ['LOGIN_FAILED', 'LOGIN_FAILED'], ['LOGOUT', 'LOGOUT'], ['SESSION_EXPIRED', 'SESSION_EXPIRED']]]]),
      this.table([['時間', (r) => fmt(r.created_at)], ['帳號', (r) => r.username], ['事件', (r) => el('span', { class: `ev ${r.success ? 'ok' : 'bad'}`, text: r.event_type })],
        ['裝置', (r) => (r.user_agent || '').slice(0, 60)]], rows),
      this.pager(rows.length),
    ];
  }

  async _ops() {
    const f = { ...(await this._userFilter()) };
    const act = clean(this.filters.action).toUpperCase();
    if (act) f.action = `eq.${act}`;
    if (this.filters.source) f.source = `eq.${this.filters.source}`;
    const rows = await supabase.select('operation_logs', { order: 'created_at.desc', limit: PAGE, offset: this.offset, filters: f });
    await this.loadNames(rows.map((r) => r.user_id));
    return [
      this.filterBar([['user', '帳號'], ['action', '動作（例如 FEED）'], ['source', '來源', [['', '全部'], ['server', 'server'], ['client', 'client']]]]),
      el('p', { class: 'hint', text: 'source=server 是後端記錄的事實；source=client 是前端回報，只供參考。' }),
      this.table([['時間', (r) => fmt(r.created_at)], ['玩家', (r) => this.who(r.user_id)], ['動作', (r) => r.action],
        ['來源', (r) => r.source], ['目標', (r) => `${r.target_type || ''} ${r.target_id || ''}`.trim()],
        ['內容', (r) => el('code', { text: JSON.stringify(r.metadata).slice(0, 140) }), 'meta']], rows),
      this.pager(rows.length),
    ];
  }

  async _audit() {
    const rows = await supabase.select('admin_actions', { order: 'created_at.desc', limit: PAGE, offset: this.offset });
    await this.loadNames(rows.flatMap((r) => [r.admin_id, r.target_user_id]));
    return [
      el('p', { class: 'hint', text: '所有管理員操作與遊戲設定修改（不可修改、不可刪除）。' }),
      this.table([['時間', (r) => fmt(r.created_at)], ['管理員', (r) => this.who(r.admin_id)], ['動作', (r) => r.action],
        ['對象', (r) => (r.target_user_id ? this.who(r.target_user_id) : `${r.target_table || ''} ${r.target_id || ''}`)],
        ['內容', (r) => el('code', { text: JSON.stringify(r.payload).slice(0, 160) }), 'meta']], rows),
      this.pager(rows.length),
    ];
  }

  // ================= 遊戲設定（game_config） =================
  async _config() {
    const rows = await supabase.select('game_config', { order: 'key.asc' });
    return [
      el('p', { class: 'hint', text: '修改後立即生效，並自動寫入 Audit Log。數值類設定請填整數。' }),
      el('div', { class: 'admin-table-wrap' }, [el('table', { class: 'admin-table' }, [
        el('thead', {}, [el('tr', {}, ['設定', '說明', '值', ''].map((t) => el('th', { text: t })))]),
        el('tbody', {}, rows.map((r) => {
          const kind = typeof r.value;
          const input = kind === 'boolean'
            ? el('select', {}, [['true', 'true'], ['false', 'false']].map(([v, t]) => el('option', { value: v, text: t })))
            : el('input', { type: kind === 'number' ? 'number' : 'text', maxlength: '200' });
          input.value = String(r.value);
          const btn = el('button', { class: 'btn small', text: '儲存' });
          btn.onclick = async () => {
            let value = input.value;
            if (kind === 'number') { value = Number(value); if (!Number.isInteger(value)) { this.app.ui.toast('請輸入整數'); return; } }
            if (kind === 'boolean') value = value === 'true';
            btn.disabled = true;
            try { await supabase.update('game_config', { key: `eq.${r.key}` }, { value, updated_at: new Date().toISOString() }); this.app.ui.toast(`已更新 ${r.key}`); }
            catch (e) { this.app.ui.toast(messageFor(e)); } finally { btn.disabled = false; }
          };
          return el('tr', {}, [el('td', {}, [el('code', { text: r.key })]), el('td', { text: r.description || '' }),
            el('td', { class: 'val' }, [input]), el('td', {}, [btn])]);
        })),
      ])]),
    ];
  }

  // ================= 認養動物 =================
  async _animals() {
    const [animals, shelters, types] = await Promise.all([
      supabase.select('animals', { order: 'created_at.asc' }),
      supabase.select('shelters', { select: 'id,name', order: 'created_at.asc' }),
      supabase.select('character_types', { select: 'code,name', order: 'sort.asc' }),
    ]);
    const rows = animals.map((a) => {
      const name = el('input', { value: a.name, maxlength: '20' });
      const listed = el('input', { type: 'checkbox' }); listed.checked = a.is_listed;
      const max = el('input', { type: 'number', value: String(a.max_adopters), min: '1', step: '1' });
      const cost = el('input', { type: 'number', value: String(a.adopt_cost), min: '0', step: '1' });
      const btn = el('button', { class: 'btn small', text: '儲存' });
      btn.onclick = () => this._patch(btn, 'animals', a.id, { name: name.value.trim(), is_listed: listed.checked,
        max_adopters: Number(max.value), adopt_cost: Number(cost.value) });
      return el('tr', {}, [el('td', {}, [name]), el('td', { text: types.find((t) => t.code === a.character_type)?.name || a.character_type }),
        el('td', { text: shelters.find((s) => s.id === a.shelter_id)?.name || '—' }),
        el('td', {}, [listed]), el('td', { class: 'val' }, [max]), el('td', { class: 'val' }, [cost]),
        el('td', { text: a.is_demo ? '示範' : '' }), el('td', {}, [btn])]);
    });
    // 新增
    const nName = el('input', { placeholder: '名字', maxlength: '20' });
    const nType = el('select', {}, types.map((t) => el('option', { value: t.code, text: t.name })));
    const nShelter = el('select', {}, shelters.map((s) => el('option', { value: s.id, text: s.name })));
    const add = el('button', { class: 'btn small primary', text: '新增動物' });
    add.onclick = async () => {
      if (!nName.value.trim()) { this.app.ui.toast('請輸入名字'); return; }
      add.disabled = true;
      try { await supabase.insert('animals', { name: nName.value.trim(), character_type: nType.value, shelter_id: nShelter.value, is_demo: false }); this.app.ui.toast('已新增'); this.render(); }
      catch (e) { add.disabled = false; this.app.ui.toast(messageFor(e)); }
    };
    return [
      el('p', { class: 'hint', text: '取消「上架」後，新玩家看不到這隻動物；已認養的玩家仍可繼續照顧。' }),
      el('div', { class: 'admin-table-wrap' }, [el('table', { class: 'admin-table' }, [
        el('thead', {}, [el('tr', {}, ['名字', '角色', '收容所', '上架', '認養上限', '認養費', '', ''].map((t) => el('th', { text: t })))]),
        el('tbody', {}, rows)])]),
      el('h3', { text: '新增認養動物' }),
      el('div', { class: 'row form' }, [nName, nType, nShelter, add]),
    ];
  }

  // ================= 收容所 =================
  async _shelters() {
    const shelters = await supabase.select('shelters', { order: 'created_at.asc' });
    const cards = shelters.map((s) => {
      const f = { name: el('input', { value: s.name, maxlength: '60' }), contact: el('input', { value: s.contact, maxlength: '120' }),
        address: el('input', { value: s.address, maxlength: '200' }), description: el('textarea', { maxlength: '1000', rows: '3' }) };
      f.description.value = s.description;
      const demo = el('input', { type: 'checkbox' }); demo.checked = s.is_demo;
      const btn = el('button', { class: 'btn small primary', text: '儲存' });
      btn.onclick = () => this._patch(btn, 'shelters', s.id, { name: f.name.value.trim(), contact: f.contact.value, address: f.address.value,
        description: f.description.value, is_demo: demo.checked });
      return el('div', { class: 'card' }, [
        el('div', { class: 'row form' }, [el('label', {}, ['名稱', f.name]), el('label', {}, ['聯絡', f.contact]), el('label', {}, ['地址', f.address])]),
        el('label', {}, ['介紹', f.description]),
        el('div', { class: 'row' }, [el('label', { class: 'check' }, [demo, document.createTextNode('示範資料')]), btn])]);
    });
    const add = el('button', { class: 'btn small', text: '新增收容所', onclick: async () => {
      try { await supabase.insert('shelters', { name: '新收容所', is_demo: false }); this.render(); } catch (e) { this.app.ui.toast(messageFor(e)); }
    } });
    return [el('p', { class: 'hint', text: '正式上線前，請把示範資料改成實際合作機構並取消「示範資料」。' }), ...cards, add];
  }

  async _patch(btn, table, id, patch) {
    btn.disabled = true;
    try { await supabase.update(table, { id: `eq.${id}` }, patch); this.app.ui.toast('已儲存（已寫入 Audit Log）'); }
    catch (e) { this.app.ui.toast(messageFor(e), 4000); }
    finally { btn.disabled = false; }
  }

  // ---------- 側邊詳細資料 ----------
  openDrawer(title, nodes) {
    $('adminDrawerTitle').textContent = title;
    $('adminDrawerBody').replaceChildren(...nodes.filter(Boolean));
    $('adminDrawer').classList.remove('hidden');
  }
  closeDrawer() { $('adminDrawer').classList.add('hidden'); }
}
