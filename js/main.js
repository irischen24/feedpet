// =====================================================================
// 《需你認養》主程式 — App 狀態機
//   BOOT → LOADING → LOGIN → MENU → ADOPT / HOME ⇄ ARENA（練習）
//   暫停、對話框、網路錯誤為覆蓋層
// =====================================================================
import { CONFIG } from './config.js';
import { supabase, NetworkError } from './net/supabaseClient.js';
import { auth } from './core/authManager.js';
import { LogManager } from './core/logManager.js';
import { messageFor } from './core/errors.js';
import { AssetManager, MANIFEST } from './engine/assetManager.js';
import { Scaler } from './engine/scaler.js';
import { InputManager } from './engine/inputManager.js';
import { AudioManager } from './engine/audioManager.js';
import { Game } from './engine/game.js';
import { drawYard, drawStorage, drawDoor, drawFoodBox, drawCrate, ART_W, ART_H } from './game/roomArt.js';
import { ROOM_DEFS } from './game/room.js';
import { RoomScene } from './game/roomScene.js';
import { DataStore } from './game/dataStore.js';
import { UIManager, el } from './ui/uiManager.js';

const $ = (id) => document.getElementById(id);
const DEBUG_ALLOWED = CONFIG.DEBUG || new URLSearchParams(location.search).get('debug') === '1';
const STATE_REFRESH_SEC = 300;

class App {
  constructor() {
    this.state = 'BOOT';
    this.ui = new UIManager();
    this.assets = new AssetManager();
    this.audio = new AudioManager();
    this.store = new DataStore(auth);
    this.logs = new LogManager(auth);
    this.scaler = new Scaler($('game'), $('stage'));
    this.input = new InputManager({
      joystickEl: $('joystick'), buttonEls: [...document.querySelectorAll('.act')],
      canvas: $('game'), scaler: this.scaler,
    });
    this.game = new Game({ scaler: this.scaler, input: this.input, debug: DEBUG_ALLOWED });
    this.scene = null;
    this.catalogLoaded = false;
    this._refreshAcc = 0;
    this._hudAcc = 0;

    this.game.onFrame = (dt) => this._tick(dt);
    this.game.debugInfo = () => ({
      ...(this.scene ? this.scene.debugInfo() : {}),
      'App State': this.state,
      'API Error': supabase.lastError ? `${supabase.lastError.path} ${supabase.lastError.code} @${supabase.lastError.at}` : '-',
      'Log Queue': this.logs.queue.length,
    });

    this._bindLayout();
    this._bindLogin();
    this._bindMenu();
    this._bindHud();
    auth.onChange((type) => { if (type === 'expired') { this.ui.toast(messageFor({ code: 'SESSION_EXPIRED' })); this.toLogin(); } });
  }

  // ---------------- Boot ----------------
  async boot() {
    this.state = 'LOADING';
    this.ui.show('loading');
    try {
      await this.assets.loadAll(MANIFEST, (d, t) => this.ui.setLoading(d, t));
    } catch (e) {
      this.ui.showNetworkError(() => location.reload());
      return;
    }
    this._buildGeneratedArt();
    this.game.start();                     // 圖片全部載入後才啟動 Game Loop
    await this.resumeSession();
  }

  _buildGeneratedArt() {
    const home = document.createElement('canvas');
    home.width = ART_W; home.height = ART_H;
    const g = home.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(this.assets.get('room_home'), 0, 0);
    g.drawImage(drawDoor(70), 316, 73);    // 門：後牆右側，底部貼齊地板線
    this.assets.set('bg_home', home);
    this.assets.set('bg_yard', drawYard());
    this.assets.set('bg_storage', drawStorage());
    this.assets.set('food_box', drawFoodBox());
    this.assets.set('crate', drawCrate());
  }

  async resumeSession() {
    try {
      const ok = await auth.restore();
      if (ok) await this.enterMenu(); else this.toLogin();
    } catch (e) {
      this.fail(e, () => this.resumeSession());
    }
  }

  fail(e, retry) {
    if (e instanceof NetworkError) this.ui.showNetworkError(retry);
    else this.ui.toast(messageFor(e));
    if (CONFIG.DEBUG) console.error(e);
  }

  // ---------------- 狀態切換 ----------------
  _stopScene() {
    if (this.scene) { this.game.setScene(null); this.scene = null; }
    this.ui.setInGame(false);
    this.game.paused = false;
  }

  toLogin() {
    this._stopScene();
    this.state = 'LOGIN';
    this.ui.show('login');
    setTimeout(() => $('loginUser').focus(), 50);
  }

  async enterMenu() {
    this._stopScene();
    if (!this.catalogLoaded) { await this.store.loadCatalog(); this.catalogLoaded = true; }
    const state = await this.store.refresh();
    this.state = 'MENU';
    this.ui.renderMenu({ profile: state.profile, hasAdoption: this.store.adoptions.length > 0 });
    this.ui.show('menu');
    this._notifyEnded();
  }

  _notifyEnded() {
    const ended = this.store.takeUnseenEnded();
    if (ended.length) this.ui.toast(`${ended.map((e) => e.animal_name).join('、')}：${this.store.text('text_expired')}`, 6000);
  }

  async openAdopt() {
    this._stopScene();
    this.state = 'ADOPT';
    this.ui.show('adopt');
    try {
      const animals = await supabase.rpc('get_animals');
      const hasGrowthCard = (this.store.state.inventory || []).some((i) => i.item_code === 'card_keep_growth' && i.qty > 0);
      this.ui.renderAdoptList(animals, {
        types: this.store.characterTypes, hasGrowthCard,
        onAdopt: (a, keep, btn) => this.adopt(a, keep, btn),
      });
      this.logs.log('UI_OPEN', { targetType: 'screen', targetId: 'adopt' });
    } catch (e) { this.fail(e, () => this.openAdopt()); }
  }

  async adopt(animal, keepGrowth, btn) {
    btn.disabled = true;
    try {
      const r = await supabase.rpc('adopt_animal', { p_animal_id: animal.id, p_use_growth_card: keepGrowth });
      await this.store.refresh();
      this.store.select(r.adoption.id);
      this.audio.sfx('pickup');
      this.ui.toast(`認養成功！${animal.name} 來到你的房間（花費 ${r.cost} 魚乾）`, 3500);
      this.enterRoom('home');
    } catch (e) {
      btn.disabled = false;
      this.fail(e, () => this.adopt(animal, keepGrowth, btn));
    }
  }

  enterRoom(roomId, spawn = 'default') {
    const adoption = this.store.selected;
    if (!adoption) { this.openAdopt(); return; }
    const def = ROOM_DEFS[roomId];
    this.ui.setPrompt(null);
    this.scene = new RoomScene({
      roomId, spawn, assets: this.assets, input: this.input, adoption,
      hooks: {
        onEnter: (r) => this.logs.log('ROOM_ENTER', { targetType: 'room', targetId: r.id }),
        onExit: (r) => this.logs.log('ROOM_EXIT', { targetType: 'room', targetId: r.id }),
        onPrompt: (t) => this.ui.setPrompt(t),
        onDoor: (action) => this.handleDoor(action),
        onPause: () => this.openPause(),
        ambientLine: () => this.store.ambientLine(),
      },
    });
    this.game.setScene(this.scene);
    this.ui.hideScreens();
    this.ui.setInGame(true, def.type === 'arena');
    this.ui.updateHud(this.store);
    this.state = def.type === 'arena' ? 'ARENA' : 'HOME';
    this.audio.sfx('door');
    this.audio.playBgm();
    if (def.type === 'arena') this.ui.toast(`${def.name}（練習）：先熟悉場地。怪物與 60 秒守護戰在 Phase 8 加入。`, 4500);
  }

  handleDoor(action) {
    if (action === 'home') { this.enterRoom('home', 'from_arena'); return; }
    if (action === 'arena_select') {
      const choose = (id) => { this.closeModalSilently(); this.enterRoom(id); };
      this.openModal('要去哪裡？', [
        el('p', { text: '選擇戰場。目前是練習模式，不會消耗體力。' }),
        el('div', { class: 'arena-choice' }, [
          el('button', { class: 'btn primary', text: '收容所後院', onclick: () => choose('arena_yard') }),
          el('button', { class: 'btn primary', text: '飼料倉庫', onclick: () => choose('arena_storage') }),
        ]),
      ]);
    }
  }

  // ---------------- 對話框（開啟時暫停遊戲與輸入） ----------------
  openModal(title, nodes, onClose) {
    this.game.paused = !!this.scene;
    this.input.enabled = false;
    this.input.reset();
    this.ui.openModal(title, nodes, () => {
      this.game.paused = false;
      this.input.enabled = true;
      if (onClose) onClose();
    });
  }
  closeModalSilently() { this.ui.closeModal(); }

  openPause() {
    if (!this.scene || this.ui.modalOpen) return;
    this.logs.log('BATTLE_PAUSE', { targetType: 'room', targetId: this.scene.room.id });
    this.openModal('暫停', [
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: '繼續', onclick: () => this.ui.closeModal() }),
        el('button', { class: 'btn', text: '設定', onclick: () => this.openSettings() }),
        el('button', { class: 'btn', text: '回到首頁', onclick: () => { this.ui.closeModal(); this.enterMenu().catch((e) => this.fail(e, () => this.enterMenu())); } }),
      ]),
    ]);
  }

  openHowTo() {
    const li = (t) => el('li', { text: t });
    this.openModal('玩法說明', [
      el('h3', { text: '遊戲循環' }),
      el('p', { text: '照護貓咪 → 累積信任 → 解鎖技能 → 守護飼料箱賺魚乾 → 餵養、升級、裝飾房間、投入助養任務。' }),
      el('h3', { text: '認養規則' }),
      el('ul', {}, [li('每隻貓咪最多 100 位認養人。'), li('從認養當下開始計時，72 小時沒有餵食，認養關係會結束。'),
                    li('每次餵食都會重新計時。')]),
      el('h3', { text: '操作' }),
      el('ul', {}, [li('電腦：WASD／方向鍵移動、Enter 互動、Space 技能、ESC 暫停。'),
                    li('手機：左下搖桿移動、右下按鈕互動；也可以直接點地板走過去。')]),
      el('h3', { text: '體力' }),
      el('p', { text: '體力低於最大值 1/3 時，貓咪會提醒你；體力歸零會生病，需要到商店買藥照顧。' }),
    ]);
  }

  async openRanking(metric = 'best_score') {
    const labels = { best_score: '最高分數', total_donated: '助養魚乾', total_trust: '信任度' };
    const list = el('ol', { class: 'rank-list' }, [el('li', { text: '讀取中…' })]);
    const tabs = el('div', { class: 'tabs' }, Object.entries(labels).map(([k, v]) =>
      el('button', { class: `tab${k === metric ? ' active' : ''}`, text: v, onclick: () => this.openRanking(k) })));
    if (this.ui.modalOpen) { $('modalBody').replaceChildren(tabs, list); } else this.openModal('排行榜', [tabs, list]);
    try {
      const rows = await supabase.rpc('get_leaderboard', { p_metric: metric, p_limit: 20 });
      list.replaceChildren(...(rows.length ? rows.map((r) => el('li', { class: r.is_me ? 'me' : '' }, [
        el('span', { text: `${r.rank}. ${r.display_name}` }), el('span', { text: String(r.value) })]))
        : [el('li', { text: '還沒有紀錄，成為第一名吧！' })]));
    } catch (e) { this.fail(e, () => this.openRanking(metric)); }
  }

  openSettings() {
    const toggle = (label, on, set) => {
      const b = el('button', { class: 'btn small', text: on ? 'ON' : 'OFF' });
      b.onclick = () => { on = !on; set(on); b.textContent = on ? 'ON' : 'OFF';
        this.logs.log('SETTINGS_CHANGE', { targetType: 'setting', targetId: label, metadata: { on } }); };
      return el('div', { class: 'toggle' }, [el('span', { text: label }), b]);
    };
    const rows = [
      toggle('音樂', this.audio.musicOn, (v) => this.audio.setMusic(v)),
      toggle('音效', this.audio.sfxOn, (v) => this.audio.setSfx(v)),
    ];
    if (DEBUG_ALLOWED) rows.push(toggle('除錯資訊（DEBUG）', this.game.debug, (v) => { this.game.debug = v; }));
    if (this.ui.modalOpen) { $('modalTitle').textContent = '設定'; $('modalBody').replaceChildren(...rows); }
    else this.openModal('設定', rows);
  }

  // ---------------- 綁定 ----------------
  _bindLayout() {
    const update = () => {
      document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth && window.innerWidth < 900);
    };
    window.addEventListener('resize', update);
    update();
    if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.scene) this.openPause();
    });
  }

  _bindLogin() {
    let mode = 'login';
    const setMode = (m) => {
      mode = m;
      document.querySelectorAll('#screen-login .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === m));
      $('registerOnly').classList.toggle('hidden', m !== 'register');
      $('btnAuth').textContent = m === 'login' ? '登入' : '註冊並開始';
      $('loginPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
      $('loginError').textContent = '';
    };
    document.querySelectorAll('#screen-login .tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.tab)));
    const submit = async () => {
      this.audio.unlock();
      $('btnAuth').disabled = true; $('loginError').textContent = '';
      try {
        if (mode === 'login') await auth.login($('loginUser').value, $('loginPass').value);
        else await auth.register($('loginUser').value, $('loginPass').value, $('loginName').value);
        $('loginPass').value = '';
        await this.enterMenu();
      } catch (e) {
        if (e instanceof NetworkError) this.ui.showNetworkError(submit);
        else $('loginError').textContent = messageFor(e);
      } finally {
        $('btnAuth').disabled = false;
      }
    };
    $('btnAuth').addEventListener('click', submit);
    for (const id of ['loginUser', 'loginPass', 'loginName']) {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
  }

  _bindMenu() {
    $('btnStart').addEventListener('click', () => {
      this.audio.unlock();
      if (this.store.adoptions.length) this.enterRoom('home'); else this.openAdopt();
    });
    $('btnHow').addEventListener('click', () => this.openHowTo());
    $('btnRanking').addEventListener('click', () => this.openRanking());
    $('btnSettings').addEventListener('click', () => this.openSettings());
    $('btnAdmin').addEventListener('click', () => this.openModal('管理後台', [
      el('p', { text: '管理後台將在 Phase 10 完成。目前可以用 tools/phase5-test.html 的管理員功能。' }),
    ]));
    $('btnLogout').addEventListener('click', async () => {
      await this.logs.flush();
      await auth.logout();
      this.toLogin();
    });
    $('btnAdoptBack').addEventListener('click', () => {
      if (this.store.adoptions.length) this.enterRoom('home');
      else this.enterMenu().catch((e) => this.fail(e, () => this.enterMenu()));
    });
    document.addEventListener('click', (e) => { if (e.target.closest('.btn, .act')) this.audio.sfx('click'); });
  }

  _bindHud() {
    $('hudMenu').addEventListener('click', () => this.openPause());
    $('hudCat').addEventListener('click', () => {
      const a = this.store.cycleSelected();
      if (a && this.scene) { this.scene.setAdoption(a); this.ui.updateHud(this.store); }
    });
  }

  // 每幀：HUD 每秒更新一次；狀態每 5 分鐘向伺服器同步（體力自然恢復、72h 計時）
  _tick(dt) {
    if (!this.scene) return;
    this._hudAcc += dt;
    if (this._hudAcc >= 1) { this._hudAcc = 0; this.ui.updateHud(this.store); }
    this._refreshAcc += dt;
    if (this._refreshAcc >= STATE_REFRESH_SEC) {
      this._refreshAcc = 0;
      this.store.refresh().then(() => {
        const a = this.store.selected;
        if (!a) { this.openAdopt(); return; }
        this.scene?.setAdoption(a);
        this._notifyEnded();
      }).catch((e) => { if (!(e instanceof NetworkError)) this.fail(e); });
    }
  }
}

const app = new App();
app.boot();
if (DEBUG_ALLOWED) window.__feedpet = app;   // 只有 ?debug=1 時才暴露，方便除錯
