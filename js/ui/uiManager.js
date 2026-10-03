// =====================================================================
// UIManager — DOM 介面。所有使用者 / 伺服器文字一律用 textContent（防 XSS）
// =====================================================================
import { MANIFEST } from '../engine/assetManager.js';

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}
export { el };

const SCREENS = ['loading', 'login', 'menu', 'adopt'];

export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UIManager {
  constructor() {
    this._toastTimer = null;
    this._modalOnClose = null;
    $('modalClose').addEventListener('click', () => this.closeModal());
    $('modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') this.closeModal(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !$('modal').classList.contains('hidden')) { e.stopPropagation(); this.closeModal(); }
    }, { capture: true });
  }

  // ---------- 畫面 ----------
  show(name) {
    for (const s of SCREENS) $(`screen-${s}`).classList.toggle('active', s === name);
  }
  hideScreens() { for (const s of SCREENS) $(`screen-${s}`).classList.remove('active'); }

  setInGame(on, isArena = false) {
    document.body.classList.toggle('in-game', on);
    document.body.classList.toggle('in-arena', on && isArena);
    $('btnInteract').textContent = isArena ? '外出籠' : '互動';
    $('btnSkill').textContent = '技能';
    $('hud').classList.toggle('hidden', !on);
    $('controls').classList.toggle('hidden', !on);
    if (!on) this.setPrompt(null);
  }

  // ---------- Loading ----------
  setLoading(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const filled = Math.round(pct / 10);
    $('loadingBar').textContent = '█'.repeat(filled) + '░'.repeat(10 - filled);
    $('loadingPct').textContent = `${pct}%`;
  }

  // ---------- Toast ----------
  toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- 網路錯誤 ----------
  showNetworkError(onRetry) {
    $('netError').classList.remove('hidden');
    $('btnRetry').onclick = () => { $('netError').classList.add('hidden'); onRetry(); };
  }
  hideNetworkError() { $('netError').classList.add('hidden'); }

  // ---------- Modal ----------
  openModal(title, bodyNodes, onClose) {
    $('modalTitle').textContent = title;
    $('modalBody').replaceChildren(...[].concat(bodyNodes));
    $('modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    this._modalOnClose = onClose || null;
    $('modalClose').focus();
  }
  closeModal() {
    if ($('modal').classList.contains('hidden')) return;
    $('modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    const cb = this._modalOnClose; this._modalOnClose = null;
    if (cb) cb();
  }
  get modalOpen() { return !$('modal').classList.contains('hidden'); }

  // ---------- 首頁 ----------
  renderMenu({ profile, hasAdoption }) {
    $('menuPlayer').textContent = `玩家：${profile.display_name}（${profile.username}）`;
    $('btnStart').textContent = hasAdoption ? '繼續照顧' : '開始認養';
    $('btnAdmin').classList.toggle('hidden', profile.role !== 'admin');
    const parade = $('parade');
    if (!parade.childElementCount) {
      for (const k of ['cat_orange', 'cat_tabby', 'cat_black', 'cat_calico', 'cat_ragdoll']) {
        parade.append(el('img', { src: MANIFEST[k], alt: '' }));
      }
    }
  }

  // ---------- 認養區 ----------
  renderAdoptList(animals, { types, hasGrowthCard, onAdopt }) {
    const list = $('adoptList');
    list.replaceChildren();
    if (!animals.length) {
      list.append(el('li', { class: 'hint', text: '目前所有貓咪的認養名額都滿了，稍後再來看看。' }));
      return;
    }
    for (const a of animals) {
      const t = types[a.character_type] || {};
      const keep = el('input', { type: 'checkbox', id: `keep-${a.id}` });
      const card = el('li', { class: 'adopt-card' }, [
        el('img', { src: MANIFEST[a.sprite_key], alt: '' }),
        el('div', {}, [
          el('h3', {}, [document.createTextNode(a.name), a.is_demo ? el('span', { class: 'tag', text: '示範' }) : null]),
          el('p', { text: `${a.character_name}・${a.role_label}` }),
          el('p', { text: `體力 ${t.max_stamina ?? '-'}・攻擊 ${t.attack ?? '-'}・任務消耗 ${t.task_cost ?? '-'}` }),
          el('p', { text: `認養人數 ${a.adopters}／${a.max_adopters}` }),
          el('p', { text: a.shelter_name ? `所屬：${a.shelter_name}` : '' }),
        ]),
        a.can_keep_growth && hasGrowthCard
          ? el('label', { class: 'check', for: `keep-${a.id}` }, [keep, document.createTextNode('使用保留成長卡')]) : null,
        a.adopted_by_me
          ? el('button', { class: 'btn', disabled: 'disabled', text: '已認養' })
          : el('button', { class: 'btn primary', text: `認養（${a.adopt_cost} 魚乾）`,
                          onclick: (e) => onAdopt(a, keep.checked, e.currentTarget) }),
      ]);
      list.append(card);
    }
  }

  // ---------- HUD ----------
  updateHud(store) {
    const a = store.selected;
    if (!a) return;
    $('hudCatImg').src = MANIFEST[a.sprite_key];
    $('hudCatName').textContent = a.animal_name;
    $('hudCatMeta').textContent = `${a.character_name} Lv.${a.level}${store.adoptions.length > 1 ? '・點我切換' : ''}`;
    this._bar('barStamina', a.stamina, a.max_stamina, a.low_stamina || a.stamina === 0);
    this._bar('barTrust', a.trust, 100, false);
    $('hudFish').textContent = `🐟 ${store.wallet.fish}`;

    const left = Math.max(0, Date.parse(a.expires_at) - store.now());
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
    const timer = $('hudTimer');
    const clock = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    timer.replaceChildren(
      el('span', { class: 'lbl', text: a.disease ? '生病：' : '餵食倒數 ' }),
      document.createTextNode(a.disease ? a.disease.name : clock));
    timer.classList.toggle('urgent', !!a.disease || a.reminder !== 'NONE');
  }
  _bar(id, v, max, low) {
    const b = $(id);
    b.classList.toggle('low', low);
    b.querySelector('i').style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
    b.querySelector('.bar-num').textContent = `${v}/${max}`;
  }

  // 戰鬥中手機按鈕顯示冷卻與剩餘次數
  updateBattleButtons({ skillName, skillCd, carrierReady, carrierLeft, carrierCd }) {
    const sk = $('btnSkill'), it = $('btnInteract');
    const skText = !skillName ? '無技能' : skillCd > 0 ? `${Math.ceil(skillCd)}s` : '技能';
    if (sk.textContent !== skText) sk.textContent = skText;
    sk.classList.toggle('cooling', !skillName || skillCd > 0);
    const itText = !carrierReady ? '未解鎖' : carrierCd > 0 ? `${Math.ceil(carrierCd)}s` : `外出籠×${carrierLeft}`;
    if (it.textContent !== itText) it.textContent = itText;
    it.classList.toggle('cooling', !carrierReady || carrierLeft <= 0 || carrierCd > 0);
  }

  updateBattleHud({ left, kills, fish, hp, maxHp, box, boxMax }) {
    const t = $('bhTime'); const txt = fmtClock(left);
    if (t.textContent !== txt) t.textContent = txt;
    t.classList.toggle('urgent', left <= 10);
    $('bhKills').textContent = `擊敗 ${kills}・🐟 ${fish}`;
    this._bar('bhHp', Math.ceil(hp), maxHp, hp / maxHp < 0.3);
    this._bar('bhBox', Math.ceil(box), boxMax, box / boxMax < 0.3);
  }

  setPrompt(text) {
    const p = $('prompt');
    if (!text) { p.classList.add('hidden'); $('btnInteract').classList.remove('pulse'); return; }
    const touch = document.body.classList.contains('touch');
    p.textContent = touch ? `按「互動」：${text}` : `Enter：${text}`;
    p.classList.remove('hidden');
    $('btnInteract').classList.add('pulse');
  }
}
