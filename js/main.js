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
import { drawYard, drawStorage, drawDoor, drawFoodBox, drawFoodBoxSheet, drawCrate, ART_W, ART_H } from './game/roomArt.js';
import { optionalManifest, SpriteSheet, CAT_ANIMS, CAT_CELL, MONSTER_ANIMS, MONSTER_CELL } from './engine/sprites.js';
import { buildMonsterSheets } from './game/monsterArt.js';
import { BattleScene } from './game/battleScene.js';
import { ROOM_DEFS } from './game/room.js';
import { RoomScene } from './game/roomScene.js';
import { DataStore } from './game/dataStore.js';
import { UIManager, el } from './ui/uiManager.js';

const $ = (id) => document.getElementById(id);
const DEBUG_ALLOWED = CONFIG.DEBUG || new URLSearchParams(location.search).get('debug') === '1';
const STATE_REFRESH_SEC = 300;
const PENDING_KEY = 'feedpet.pendingBattle.v1';

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
    const opt = optionalManifest();
    const total = Object.keys(MANIFEST).length + Object.keys(opt).length;
    try {
      await this.assets.loadAll(MANIFEST, (d) => this.ui.setLoading(d, total));
      const base = Object.keys(MANIFEST).length;
      this.customAssets = await this.assets.loadOptional(opt, (d) => this.ui.setLoading(base + d, total));
    } catch (e) {
      this.ui.showNetworkError(() => location.reload());
      return;
    }
    this._validateCustomAssets();
    this._buildGeneratedArt();
    this.game.start();                     // 圖片全部載入後才啟動 Game Loop
    await this.resumeSession();
  }

  // 你上傳的圖如果尺寸不符規格，就不使用並在 DEBUG 模式提示
  _validateCustomAssets() {
    this.assetWarnings = [];
    const check = (key, w, h, frames) => {
      if (!this.assets.has(key)) return;
      const err = SpriteSheet.validate(this.assets.get(key), w, h, frames);
      if (err) { this.assets.images.delete(key); this.assetWarnings.push(`${key}: ${err}`); }
    };
    for (const key of this.customAssets) {
      let m;
      if ((m = /^cat_(\w+?)_(\w+)$/.exec(key)) && CAT_ANIMS[m[2]]) check(key, CAT_CELL.w, CAT_CELL.h, CAT_ANIMS[m[2]].frames);
      else if ((m = /^monster_(\w+?)_(\w+)$/.exec(key)) && MONSTER_ANIMS[m[2]]) check(key, MONSTER_CELL[m[1]].w, MONSTER_CELL[m[1]].h, MONSTER_ANIMS[m[2]].frames);
      else if (key.startsWith('file_arena_')) check(key, ART_W, ART_H, 1);
      else if (key === 'file_prop_food_box') check(key, 32, 26, 3);
      else if (key === 'file_prop_crate') check(key, 30, 26, 1);
    }
    if (this.assetWarnings.length) console.warn('[FeedPet] 素材尺寸不符規格，已改用內建版本：\n' + this.assetWarnings.join('\n'));
    if (this.assetWarnings.length && DEBUG_ALLOWED) setTimeout(() => this.ui.toast(`有 ${this.assetWarnings.length} 張素材尺寸不符規格，詳見 Console`, 5000), 1500);
  }

  _buildGeneratedArt() {
    const home = document.createElement('canvas');
    home.width = ART_W; home.height = ART_H;
    const g = home.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(this.assets.get('room_home'), 0, 0);
    g.drawImage(drawDoor(70), 316, 73);    // 門：後牆右側，底部貼齊地板線
    this.assets.set('bg_home', home);
    const pick = (fileKey, fallback) => (this.assets.has(fileKey) ? this.assets.get(fileKey) : fallback());
    this.assets.set('bg_yard', pick('file_arena_yard', drawYard));
    this.assets.set('bg_storage', pick('file_arena_storage', drawStorage));
    this.assets.set('food_box_sheet', pick('file_prop_food_box', drawFoodBoxSheet));
    this.assets.set('food_box', drawFoodBox());
    this.assets.set('crate', pick('file_prop_crate', drawCrate));
    buildMonsterSheets(this.assets);                 // 沒上傳的怪物動作用內建版本
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
    await this._abandonPending();
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
    if (action === 'arena_select') this.openBattlePrep();
  }

  // ================= Phase 8：60 秒守護戰 =================
  openBattlePrep() {
    const a = this.store.selected;
    if (!a) return;
    if (a.disease) {
      this.openModal('貓咪生病了', [
        el('p', { text: `${a.animal_name}得了${a.disease.name}，生病時不能出戰。` }),
        el('p', { text: `需要的藥物：${a.disease.cure_item_code === 'med_spot' ? '外用驅蟲滴劑' : a.disease.cure_item_code === 'med_ear' ? '耳道殺蟎滴劑' : '心絲蟲照護藥'}（商店與用藥在 Phase 9 開放）。` }),
        el('p', { class: 'hint', text: a.disease.edu_reference }),
      ]);
      return;
    }
    if (a.stamina <= 0) { this.openModal('體力不足', [el('p', { text: '體力已經用完，先休息或餵食吧。' })]); return; }

    let arena = 'arena_yard';
    const unlocked = a.skills.filter((s) => s.unlocked);
    let skill = unlocked.length ? unlocked[unlocked.length - 1].code : null;
    const arenaBtns = [['arena_yard', '收容所後院', '開闊草地'], ['arena_storage', '飼料倉庫', '有木箱障礙']].map(([id, name, desc]) =>
      el('button', { class: `choice${id === arena ? ' selected' : ''}`, 'data-id': id, onclick: (e) => {
        arena = id; e.currentTarget.parentNode.querySelectorAll('.choice').forEach((b) => b.classList.toggle('selected', b.dataset.id === id));
      } }, [el('strong', { text: name }), document.createTextNode(desc)]));
    const skillBtns = [{ code: null, name: '不使用', description: '', unlocked: true, trust_required: 0 }, ...a.skills].map((sk) =>
      el('button', { class: `choice${sk.code === skill ? ' selected' : ''}`, 'data-id': String(sk.code), ...(sk.unlocked ? {} : { disabled: 'disabled' }),
        onclick: (e) => { skill = sk.code; e.currentTarget.parentNode.querySelectorAll('.choice').forEach((b) => b.classList.toggle('selected', b.dataset.id === String(sk.code))); } },
      [el('strong', { text: sk.name }), document.createTextNode(sk.unlocked ? (sk.description || '　') : `信任 ${sk.trust_required} 解鎖`)]));
    const after = Math.max(0, a.stamina - a.task_cost);
    this.openModal('出門守護飼料箱', [
      el('div', { class: 'prep-section' }, [el('h3', { text: '戰場' }), el('div', { class: 'choice-grid' }, arenaBtns)]),
      el('div', { class: 'prep-section' }, [el('h3', { text: `技能（目前信任 ${a.trust}）` }), el('div', { class: 'choice-grid' }, skillBtns)]),
      el('p', { text: `消耗體力 ${a.task_cost}（${a.stamina} → ${after}）。外出籠：${a.carrier_ready ? '可使用' : '認養滿 48 小時後解鎖'}。` }),
      after === 0 ? el('p', { class: 'warn', text: '這場之後體力會歸零，貓咪會生病。' }) : null,
      el('p', { class: 'hint', text: '開戰後伺服器開始計時，暫停不會停止伺服器計時；暫停超過 10 分鐘這場會作廢。' }),
      el('button', { class: 'btn primary wide', text: '開始守護', onclick: () => { this.ui.closeModal(); this.startBattle(arena, skill); } }),
    ].filter(Boolean));
  }

  async startBattle(arena, skillCode) {
    const adoption = this.store.selected;
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { pending = null; }
    // 同一次開戰的重試沿用同一把 key：後端保證不重複扣體力
    const key = pending && !pending.sessionId && pending.adoptionId === adoption.id ? pending.key : crypto.randomUUID();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ key, adoptionId: adoption.id }));
    let start;
    try {
      start = await supabase.rpc('start_battle', {
        p_adoption_id: adoption.id, p_skill_code: skillCode, p_room_code: arena, p_idempotency_key: key,
      });
    } catch (e) {
      if (!(e instanceof NetworkError)) sessionStorage.removeItem(PENDING_KEY);
      this.fail(e, () => this.startBattle(arena, skillCode));
      return;
    }
    if (start.replayed && start.status !== 'PLAYING') { sessionStorage.removeItem(PENDING_KEY); this.ui.toast('這場已經結束了'); return; }
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ key, adoptionId: adoption.id, sessionId: start.session_id }));
    if (start.became_sick) this.ui.toast(`體力歸零，${adoption.animal_name}生病了！這場打完要記得照顧牠。`, 4500);

    const skill = skillCode ? start.adoption.skills.find((s) => s.code === skillCode) : null;
    this.battle = { sessionId: start.session_id, skill, arena };
    this.ui.setPrompt(null);
    this.scene = new BattleScene({
      roomId: arena, assets: this.assets, input: this.input, start, skill, monsterStats: this.store.monsters,
      hooks: {
        onEnter: (r) => this.logs.log('ROOM_ENTER', { targetType: 'room', targetId: r.id, sessionId: start.session_id }),
        onExit: (r) => this.logs.log('ROOM_EXIT', { targetType: 'room', targetId: r.id, sessionId: start.session_id }),
        onPause: () => this.openPause(),
        onNotice: (t) => this.ui.toast(t, 1800),
        onSkill: (code) => { this.audio.sfx('pickup'); this.logs.log('SKILL_USE', { targetType: 'skill', targetId: code, sessionId: start.session_id }); },
        onCarrier: (heal) => { this.audio.sfx('pickup'); this.logs.log('ITEM_USE', { targetType: 'item', targetId: 'carrier', sessionId: start.session_id, metadata: { heal } }); },
        onResult: (result) => this.audio.sfx(result === 'WIN' ? 'victory' : 'gameover'),
        onEnd: (report) => this.finishBattle(report),
        sfx: (n) => this.audio.sfx(n),
        isTouch: () => document.body.classList.contains('touch'),
        domHud: () => document.body.classList.contains('portrait'),
      },
    });
    this.game.setScene(this.scene);
    this.ui.hideScreens();
    this.ui.setInGame(true, true);
    this.state = 'BATTLE';
    this.audio.sfx('door');
  }

  async finishBattle(report) {
    const sid = this.battle?.sessionId;
    if (!sid) return;
    const k = report.kills;
    const meta = { sessionId: sid };
    this.logs.log('MONSTER_DEFEATED', { ...meta, targetType: 'session', targetId: sid, metadata: { kills: k } });
    if (report.damage_taken) this.logs.log('PLAYER_DAMAGE', { ...meta, targetType: 'session', targetId: sid, metadata: { total: report.damage_taken } });
    if (report.reason === 'faint') this.logs.log('PLAYER_DEATH', { ...meta, targetType: 'session', targetId: sid });
    if (report.result === 'WIN') this.logs.log('LEVEL_COMPLETE', { ...meta, targetType: 'room', targetId: this.battle.arena });

    let res;
    try {
      res = await supabase.rpc('end_battle', { p_session_id: sid, p_report: report });   // 後端冪等：重送不會重複發獎
    } catch (e) {
      this.fail(e, () => this.finishBattle(report));
      return;
    }
    sessionStorage.removeItem(PENDING_KEY);
    this.battle = null;
    this.store.refresh().catch(() => {});
    this.showBattleResult(report, res);
  }

  showBattleResult(report, res) {
    const win = res.status === 'COMPLETED';
    const r = res.result || {};
    const kills = r.kills || report.kills;
    const reasons = { faint: '貓咪累倒了', box: '飼料箱被吃光了', time: '撐滿 60 秒！' };
    const nodes = [
      el('p', { class: 'result-title', text: win ? '守護成功！' : '守護失敗' }),
      el('p', { class: 'hint', text: res.status === 'ABANDONED' ? '這場已經逾時作廢。' : (win ? reasons.time : reasons[report.reason] || '') }),
      el('div', { class: 'result-grid' }, [
        el('div', {}, [el('b', { text: String(res.score ?? 0) }), document.createTextNode('分數')]),
        el('div', {}, [el('b', { text: `🐟 ${res.fish_reward ?? 0}` }), document.createTextNode('獲得魚乾')]),
        el('div', {}, [el('b', { text: String(kills.dust || 0) }), document.createTextNode('灰塵怪')]),
        el('div', {}, [el('b', { text: String((kills.hunger || 0) + (kills.mischief || 0)) }), document.createTextNode('飢餓怪＋搗蛋怪')]),
      ]),
      r.daily_cap_reached ? el('p', { class: 'warn', text: '今天的戰鬥魚乾已達上限。' }) : null,
      el('p', { class: 'hint', text: '分數與魚乾由伺服器驗證後計算。' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: '回家', onclick: () => this.ui.closeModal() }),
        el('button', { class: 'btn', text: '再守護一場', onclick: () => { this._afterResult = 'again'; this.ui.closeModal(); } }),
      ]),
    ].filter(Boolean);
    this._afterResult = 'home';
    this.openModal('戰鬥結果', nodes, async () => {
      try { await this.store.refresh(); } catch { /* 顯示用，失敗不影響 */ }
      this.enterRoom('home', 'from_arena');
      if (this._afterResult === 'again') this.openBattlePrep();
    });
  }

  async abandonBattle() {
    const sid = this.battle?.sessionId;
    this.battle = null;
    sessionStorage.removeItem(PENDING_KEY);
    if (sid) await supabase.rpc('abandon_battle', { p_session_id: sid }).catch(() => {});
  }

  async _abandonPending() {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { pending = null; }
    if (pending?.sessionId && !this.battle) {
      await supabase.rpc('abandon_battle', { p_session_id: pending.sessionId }).catch(() => {});
      sessionStorage.removeItem(PENDING_KEY);
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
    if (this.state === 'BATTLE') {
      this.openModal('暫停', [
        el('p', { class: 'hint', text: '伺服器計時不會暫停；暫停超過 10 分鐘這場會作廢。' }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn primary', text: '繼續', onclick: () => this.ui.closeModal() }),
          el('button', { class: 'btn', text: '設定', onclick: () => this.openSettings() }),
          el('button', { class: 'btn', text: '放棄這場', onclick: async () => {
            this.ui.closeModal(); await this.abandonBattle(); this.ui.toast('已放棄這場，體力不會退還。');
            this.store.refresh().catch(() => {}).finally(() => this.enterRoom('home', 'from_arena'));
          } }),
        ]),
      ], () => this.logs.log('BATTLE_RESUME', { targetType: 'room', targetId: this.scene?.room.id }));
      return;
    }
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
    if (this.state === 'BATTLE') {
      const b = this.scene;
      this.ui.updateBattleButtons({ skillName: b.skill?.name, skillCd: b.skillCd, carrierReady: b.carrier.ready,
        carrierLeft: b.carrier.left, carrierCd: b.carrier.cd });
      if (document.body.classList.contains('portrait')) {
        this._hudAcc += dt;
        if (this._hudAcc >= 0.1) {
          this._hudAcc = 0;
          const k = b.kills;
          this.ui.updateBattleHud({ left: b.duration - b.t, kills: k.dust + k.hunger + k.mischief, fish: b.fishPreview,
            hp: b.hp, maxHp: b.maxHp, box: b.box.hp, boxMax: b.box.max });
        }
      }
      return;
    }
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
