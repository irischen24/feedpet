// =====================================================================
// Phase 9 面板：照護、商店／背包、助養任務、照護小遊戲
// 所有數值變動都呼叫後端 RPC；畫面只顯示伺服器回傳的結果。
// =====================================================================
import { el } from './uiManager.js';
import { iconUrl } from '../game/homeFurniture.js';

const TASK_INFO = {
  litter: { name: '鏟貓砂', hint: '把 4 團髒污點掉' },
  brush: { name: '刷牙', hint: '按住後滑過每一顆牙齒' },
  wand: { name: '逗貓棒', hint: '12 秒內點到逗貓棒 5 次' },
  nail: { name: '指甲照護', hint: '點每一隻爪子修剪' },
};
const MED_NAME = { med_spot: '外用驅蟲滴劑', med_ear: '耳道殺蟎滴劑', med_heartworm: '心絲蟲照護藥' };
const SHOP_TABS = [['food', '食物'], ['medicine', '藥物'], ['furniture', '家具'], ['decor', '裝飾'], ['card', '道具'], ['bag', '背包']];

const qtyOf = (state, code) => (state.inventory || []).find((i) => i.item_code === code)?.qty || 0;
const fmtHours = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };

export class Panels {
  // app 提供：ui、store、rpc(name,args)、onFed(adoption)、openModal、setBody、toast、logs
  constructor(app) { this.app = app; }

  // ================= 照護 =================
  openCare() {
    this.app.logs.log('UI_OPEN', { targetType: 'panel', targetId: 'care' });
    this.app.openModal('照護', this.careBody(), null, 'care');
  }

  careBody() {
    const { store } = this.app;
    const a = store.selected, st = store.state;
    if (!a) return [el('p', { text: '還沒有認養貓咪。' })];
    const left = Date.parse(a.expires_at) - store.now();
    const nodes = [
      el('p', { class: 'care-head', text: `${a.animal_name}・${a.character_name} Lv.${a.level}（經驗 ${a.exp}/${a.exp_to_next}）` }),
      el('p', { text: `體力 ${a.stamina}/${a.max_stamina}　信任 ${a.trust}/100　餵食倒數 ${fmtHours(left)}` }),
    ];
    if (a.low_stamina) nodes.push(el('p', { class: 'warn', text: store.text('text_low_stamina') }));

    // 生病
    if (a.disease) {
      const med = a.disease.cure_item_code, have = qtyOf(st, med);
      nodes.push(el('div', { class: 'card sick' }, [
        el('h3', { text: `生病：${a.disease.name}` }),
        el('p', { text: a.disease.cause_text }),
        el('p', { text: a.disease.care_text }),
        el('p', { class: 'hint', text: a.disease.edu_reference }),
        have
          ? el('button', { class: 'btn primary', text: `使用${MED_NAME[med]}（剩 ${have}）`, onclick: (e) => this.act(e, 'use_medicine', { p_adoption_id: a.id, p_item_code: med }, () => `${a.animal_name}康復了！`) })
          : el('button', { class: 'btn', text: `到商店買${MED_NAME[med]}`, onclick: () => this.openShop('medicine') }),
      ]));
    }

    // 餵食
    const foods = (st.inventory || []).filter((i) => i.qty > 0 && this.app.store.items[i.item_code]?.type === 'food');
    nodes.push(el('h3', { text: '餵食' }));
    nodes.push(el('p', { class: 'hint', text: '每次餵食都會重新計算 72 小時；每天第一次餵食加信任 5。' + (a.disease ? '生病時餵食不會恢復體力。' : '') }));
    nodes.push(foods.length
      ? el('div', { class: 'choice-grid' }, foods.map((f) => {
        const it = this.app.store.items[f.item_code];
        return el('button', { class: 'choice', onclick: (e) => this.feed(e, a, f.item_code) }, [
          el('img', { class: 'icon', src: iconUrl(f.item_code), alt: '' }),
          el('strong', { text: `${it.name} ×${f.qty}` }), document.createTextNode(`體力 +${it.effect.stamina || 0}`)]);
      }))
      : el('div', { class: 'row' }, [el('span', { text: '背包沒有食物。' }), el('button', { class: 'btn small', text: '去商店', onclick: () => this.openShop('food') })]));

    // 每日照護
    nodes.push(el('h3', { text: '每日照護' }));
    nodes.push(el('p', { class: 'hint', text: '每項每天第一次完成給完整獎勵。' }));
    nodes.push(el('div', { class: 'choice-grid' }, Object.entries(TASK_INFO).map(([code, info]) => {
      const done = a.tasks_today.includes(code);
      const task = this.app.store.careTasks[code] || {};
      return el('button', { class: `choice${done ? ' done' : ''}`, onclick: () => this.openMiniGame(code) }, [
        el('strong', { text: `${done ? '✓ ' : ''}${info.name}` }),
        document.createTextNode(done ? '今天已完成，可以再玩' : `信任 +${task.trust_reward ?? 0}${task.fish_reward ? `・🐟 +${task.fish_reward}` : ''}`)]);
    })));

    // 休息
    const restAt = Date.parse(a.rest_ready_at) - store.now();
    nodes.push(el('h3', { text: '休息' }));
    nodes.push(el('div', { class: 'row' }, [
      el('button', { class: 'btn', text: restAt > 0 ? `休息冷卻中（${fmtHours(restAt)}）` : '讓貓咪休息（體力 +15）',
        ...(restAt > 0 || a.disease ? { disabled: 'disabled' } : {}),
        onclick: (e) => this.act(e, 'rest_pet', { p_adoption_id: a.id }, (r) => `休息完畢，體力 +${r.stamina_gain}`) }),
    ]));
    return nodes;
  }

  async act(e, rpc, args, msg) {
    const btn = e?.currentTarget; if (btn) btn.disabled = true;
    try {
      const r = await this.app.rpc(rpc, args);
      await this.app.store.refresh();
      this.app.ui.toast(typeof msg === 'function' ? msg(r) : msg);
      this.app.afterStateChange();
      if (this.app.ui.modalOpen && this.app.modalKind === 'care' && !this._inMini) this.app.setModalBody(this.careBody());
      return r;
    } catch (err) {
      if (btn) btn.disabled = false;
      this.app.fail(err, () => this.act(null, rpc, args, msg));
      return null;
    }
  }

  async feed(e, a, code) {
    const r = await this.act(e, 'feed_pet', { p_adoption_id: a.id, p_item_code: code },
      (res) => `${a.animal_name}吃得好開心！體力 +${res.stamina_gain}${res.rewarded ? '・信任 +5' : ''}${res.level_up ? `・升到 Lv.${res.adoption.level}！` : ''}`);
    if (r) this.app.onFed();
  }

  // ================= 照護小遊戲 =================
  openMiniGame(code) {
    this._inMini = true;
    const a = this.app.store.selected;
    const info = TASK_INFO[code];
    const area = el('div', { class: `mini mini-${code}` });
    const status = el('p', { class: 'mini-status', text: info.hint });
    const back = el('button', { class: 'btn small', text: '返回照護', onclick: () => { this._inMini = false; this.app.setModalBody(this.careBody()); } });
    this.app.setModalBody([el('h3', { text: info.name }), status, area, el('div', { class: 'row' }, [back])]);
    const finish = async () => {
      status.textContent = '完成！';
      const r = await this.act(null, 'complete_care_task', { p_adoption_id: a.id, p_task_code: code },
        (res) => (res.rewarded ? `${info.name}完成！信任 +${res.trust_gain}${res.fish_gain ? `・🐟 +${res.fish_gain}` : ''}` : `${info.name}完成！（今天的獎勵已經領過了）`));
      this._inMini = false;
      if (r && this.app.modalKind === 'care') setTimeout(() => { if (this.app.modalKind === 'care' && !this._inMini) this.app.setModalBody(this.careBody()); }, 700);
    };
    MINI[code](area, status, finish);
  }

  // ================= 商店 / 背包 =================
  openShop(tab = 'food') {
    this.app.logs.log('UI_OPEN', { targetType: 'panel', targetId: `shop_${tab}` });
    this.app.openModal('商店', this.shopBody(tab), null, 'shop');
  }

  shopBody(tab) {
    const { store } = this.app;
    const tabs = el('div', { class: 'tabs shop-tabs' }, SHOP_TABS.map(([k, v]) =>
      el('button', { class: `tab${k === tab ? ' active' : ''}`, text: v, onclick: () => this.app.setModalBody(this.shopBody(k)) })));
    const wallet = el('p', { class: 'wallet', text: `🐟 魚乾 ${store.wallet.fish}` });
    let content;
    if (tab === 'bag') {
      const inv = (store.state.inventory || []).filter((i) => i.qty > 0);
      content = inv.length
        ? el('ul', { class: 'shop-list' }, inv.map((i) => {
          const it = store.items[i.item_code] || { name: i.item_code, description: '' };
          return el('li', { class: 'shop-item' }, [el('img', { class: 'icon', src: iconUrl(i.item_code), alt: '' }),
            el('div', {}, [el('strong', { text: `${it.name} ×${i.qty}` }), el('p', { text: it.description || '' })])]);
        }))
        : el('p', { text: '背包是空的。' });
    } else {
      const list = Object.values(store.items).filter((it) => it.type === tab && it.is_active && it.price_fish != null)
        .sort((x, y) => x.sort - y.sort);
      content = el('ul', { class: 'shop-list' }, list.map((it) => this._shopItem(it, tab)));
    }
    const notes = [];
    if (tab === 'medicine') notes.push(el('p', { class: 'hint', text: '遊戲中的藥品是虛擬道具，用來照顧遊戲裡的貓咪；真實的貓咪用藥請諮詢獸醫。' }));
    if (tab === 'furniture' || tab === 'decor') notes.push(el('p', { class: 'hint', text: '買好之後，在房間按「裝飾」擺放。' }));
    return [wallet, tabs, ...notes, content];
  }

  _shopItem(it, tab) {
    const { store } = this.app;
    let qty = 1;
    const owned = qtyOf(store.state, it.code);
    const num = el('span', { class: 'qty', text: '1' });
    const total = el('span', { class: 'price', text: `🐟 ${it.price_fish}` });
    const buy = el('button', { class: 'btn primary small', text: '購買' });
    const sync = () => {
      num.textContent = String(qty); total.textContent = `🐟 ${it.price_fish * qty}`;
      buy.disabled = it.price_fish * qty > store.wallet.fish;
    };
    const step = (d) => { qty = Math.min(99, Math.max(1, qty + d)); sync(); };
    buy.onclick = async (e) => {
      const r = await this.act(e, 'buy_item', { p_item_code: it.code, p_qty: qty }, (res) => `買了 ${it.name} ×${res.qty}`);
      if (r && this.app.ui.modalOpen) this.app.setModalBody(this.shopBody(tab));
    };
    sync();
    const single = tab === 'decor';                 // 地板、壁紙只需要一份
    return el('li', { class: 'shop-item' }, [
      el('img', { class: 'icon', src: iconUrl(it.code), alt: '' }),
      el('div', {}, [el('strong', { text: it.name }), el('p', { text: `${it.description || ''}${owned ? `（已有 ${owned}）` : ''}` }),
        it.brand_info ? el('p', { class: 'brand', text: `合作品牌：${it.brand_info.name || ''}` }) : null]),
      el('div', { class: 'buy' }, [
        single ? null : el('div', { class: 'stepper' }, [el('button', { class: 'btn small', text: '−', onclick: () => step(-1) }), num,
          el('button', { class: 'btn small', text: '+', onclick: () => step(1) })]),
        total, (tab === 'decor' && owned) ? el('span', { class: 'hint', text: '已擁有' }) : buy]),
    ]);
  }

  // ================= 助養任務 =================
  async openCharity() {
    this.app.logs.log('UI_OPEN', { targetType: 'panel', targetId: 'charity' });
    const list = el('div', {}, [el('p', { text: '讀取中…' })]);
    this.app.openModal('助養任務', [
      el('p', { class: 'hint', text: '把遊戲中賺到的魚乾投入助養任務。魚乾是遊戲虛擬點數，不代表實際捐款；有企業合作時，會依活動約定換算成飼料或醫療經費。' }),
      list,
    ], null, 'charity');
    try {
      const tasks = await this.app.rpc('get_charity_progress', {});
      list.replaceChildren(...tasks.map((t) => {
        const pct = Math.min(100, Math.round((t.donated_fish / t.goal_fish) * 100));
        let amount = 10;
        const amt = el('span', { class: 'qty', text: '10' });
        const quick = [10, 50, 100].map((n) => el('button', { class: 'btn small', text: `${n}`, onclick: () => { amount = n; amt.textContent = String(n); } }));
        return el('div', { class: 'card' }, [
          el('h3', {}, [document.createTextNode(t.title), t.is_demo ? el('span', { class: 'tag', text: '示範' }) : null]),
          el('p', { class: 'hint', text: `${t.shelter_name || ''}　${t.description}` }),
          el('div', { class: 'bar progress' }, [el('span', { class: 'bar-track' }, [el('i', { class: `w${pct}` })]),
            el('span', { class: 'bar-num', text: `${t.donated_fish}/${t.goal_fish}` })]),
          el('div', { class: 'row' }, [...quick, amt,
            el('button', { class: 'btn primary small', text: '投入魚乾', onclick: (e) => this.act(e, 'donate_fish', { p_task_id: t.id, p_fish: amount }, `投入了 🐟 ${amount}，謝謝你！`).then((r) => r && this.openCharity()) })]),
        ]);
      }));
      list.querySelectorAll('.progress i').forEach((i) => { i.style.width = `${i.className.slice(1)}%`; });
    } catch (e) { this.app.fail(e, () => this.openCharity()); }
  }
}

// =====================================================================
// 小遊戲（DOM + Pointer Events，手機與滑鼠都能玩）
// =====================================================================
const MINI = {
  litter(area, status, done) {
    let left = 4;
    for (let i = 0; i < 4; i++) {
      const c = el('button', { class: 'clump', 'aria-label': '髒污' });
      c.style.left = `${10 + Math.random() * 75}%`; c.style.top = `${15 + Math.random() * 65}%`;
      c.onpointerdown = (e) => { e.preventDefault(); c.remove(); left -= 1; status.textContent = `剩 ${left} 團`; if (!left) done(); };
      area.append(c);
    }
  },
  brush(area, status, done) {
    const teeth = Array.from({ length: 6 }, () => el('span', { class: 'tooth' }));
    const row = el('div', { class: 'teeth' }, teeth);
    area.append(el('div', { class: 'mouth' }, [row]));
    let down = false, cleaned = 0, finished = false;
    const touch = (x, y) => {
      const t = document.elementFromPoint(x, y);
      if (t && t.classList.contains('tooth') && !t.classList.contains('clean')) {
        t.classList.add('clean'); cleaned += 1; status.textContent = `已刷 ${cleaned}/6`;
        if (cleaned === 6 && !finished) { finished = true; done(); }
      }
    };
    area.onpointerdown = (e) => { e.preventDefault(); down = true; area.setPointerCapture(e.pointerId); touch(e.clientX, e.clientY); };
    area.onpointermove = (e) => { if (down) touch(e.clientX, e.clientY); };
    area.onpointerup = () => { down = false; };
  },
  wand(area, status, done) {
    let hits = 0, over = false;
    const toy = el('button', { class: 'toy', 'aria-label': '逗貓棒' });
    area.append(toy);
    const moveToy = () => { toy.style.left = `${5 + Math.random() * 80}%`; toy.style.top = `${10 + Math.random() * 70}%`; };
    moveToy();
    const timer = setInterval(() => { if (!over) moveToy(); }, 900);
    const fail = setTimeout(() => { if (!over) { over = true; clearInterval(timer); status.textContent = `時間到（${hits}/5），再試一次！`; toy.remove(); } }, 12000);
    toy.onpointerdown = (e) => {
      e.preventDefault(); if (over) return;
      hits += 1; status.textContent = `抓到 ${hits}/5`; moveToy();
      if (hits >= 5) { over = true; clearInterval(timer); clearTimeout(fail); done(); }
    };
  },
  nail(area, status, done) {
    let left = 4;
    const paw = el('div', { class: 'paw' }, Array.from({ length: 4 }, () => {
      const c = el('button', { class: 'claw', 'aria-label': '爪子' });
      c.onpointerdown = (e) => { e.preventDefault(); if (c.classList.contains('cut')) return; c.classList.add('cut'); left -= 1; status.textContent = `剩 ${left} 隻`; if (!left) done(); };
      return c;
    }));
    area.append(paw);
  },
};
