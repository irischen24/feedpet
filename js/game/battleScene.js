// =====================================================================
// BattleScene — 60 秒守護飼料箱（Excel）
//   COUNTDOWN(3s) → FIGHT(60s) → END
//   * 出怪表由後端 start_battle 產生（spawn_plan），前端照表生怪
//   * 貓咪自動攻擊範圍內最近的怪物；Space 技能、Enter 外出籠
//   * 勝利：撐滿 60 秒且飼料箱生命 > 0；失敗：貓咪累倒或飼料箱被打爆
//   * 結果只回報給後端 end_battle，分數與魚乾由後端驗證後計算
// =====================================================================
import { Room, ROOM_DEFS } from './room.js';
import { Cat } from './player.js';
import { Monster } from './monster.js';
import { SpriteSheet } from '../engine/sprites.js';
import { PX } from './roomArt.js';
import { fmtClock } from '../ui/uiManager.js';

const COUNTDOWN = 3;
const AUTO_RANGE = 115;            // 貓腳底到怪物腳底（y 方向 ×1.4 透視修正）
const AUTO_PERIOD = 0.75;          // 自動攻擊間隔（秒）— 平衡測試後調整
const IFRAMES = 0.8;               // 受傷後無敵時間
const CLEAVE = 3;                  // 一次揮爪最多命中幾隻

export class BattleScene {
  constructor({ roomId, assets, input, start, skill, monsterStats, hooks }) {
    this.room = new Room(ROOM_DEFS[roomId], assets);
    const boxProp = this.room.props.find((p) => p.id === 'food_box');
    this.room.props = this.room.props.filter((p) => p.id !== 'food_box');   // 飼料箱改由戰鬥自己畫（有受損狀態）
    this.input = input;
    this.hooks = hooks;
    this.assets = assets;
    this.start = start;
    this.adoption = start.adoption;
    this.duration = start.duration_sec || 60;
    this.monsterStats = monsterStats;
    this.skill = skill || null;
    this.carrier = { ...start.carrier, left: start.carrier.uses, cd: 0 };

    this.cat = new Cat(assets, this.adoption, this.room.spawn());
    this.maxHp = this.adoption.battle_hp;
    this.hp = this.maxHp;
    this.atk = this.adoption.attack;
    this.atkCd = 0.5;
    this.autoPeriod = AUTO_PERIOD;
    this.cleave = CLEAVE;
    this.iframes = IFRAMES;
    this.skillCd = 0;

    const boxSheet = new SpriteSheet(assets.get('food_box_sheet'), 32, 26);
    this.box = {
      x: boxProp.x, y: boxProp.y, hp: start.food_box_hp, max: start.food_box_hp, sheet: boxSheet, flashT: 0,
      rect: boxProp.solid,
      get center() { return { x: this.x, y: this.y - 12 }; },
    };

    this.phase = 'COUNTDOWN';
    this.countdown = COUNTDOWN;
    this.t = 0;
    this.endT = 0;
    this.result = null;
    this.monsters = [];
    this.queue = [...start.spawn_plan].sort((a, b) => a.t - b.t);
    this.kills = { dust: 0, hunger: 0, mischief: 0 };
    this.fishPreview = 0;
    this.damageTaken = 0;
    this.fx = [];
    this.fx2 = [];
    this.effects = {};                 // 技能持續效果：{ multiHit, dodge, shield, invuln, slow, spin } 結束時間
    this.monsterSpeedMul = 1;
    this.stats = { skillUses: 0, carrierUses: 0, dodges: 0 };
  }

  enter() { this.hooks.onEnter?.(this.room); }
  exit() { this.hooks.onExit?.(this.room); }
  onPause() { if (this.phase !== 'END') this.hooks.onPause?.(); }

  // ---------------- 共用：移動與距離 ----------------
  moveEntity(e, dx, dy) { return this.room.collision.move(e, dx, dy); }
  distToBox(m) {
    const r = this.box.rect;
    const cx = Math.max(r.x, Math.min(m.x, r.x + r.w)), cy = Math.max(r.y, Math.min(m.y, r.y + r.h));
    return Math.hypot(m.x - cx, (m.y - cy) * 1.4);
  }
  _active(name) { return (this.effects[name] || 0) > this.t; }

  // ---------------- 傷害 ----------------
  damageCat(amount, from) {
    if (this.phase !== 'FIGHT' || this.cat.state === 'FAINT') return;
    if (this._active('invuln') || this.cat.flashT > 0) return;
    if (this._active('dodge') && Math.random() < (this.skill?.effect.chance || 0.3)) {
      this.stats.dodges += 1; this._text(this.cat.x, this.cat.y - this.cat.h, 'MISS', '#8DCFFF'); return;
    }
    let dmg = amount;
    if (this._active('shield')) dmg = Math.round(dmg * (1 - (this.skill?.effect.reduce || 0.3)));
    this.hp = Math.max(0, this.hp - dmg);
    this.damageTaken += dmg;
    this.cat.playHurt();
    this.cat.flashT = this.iframes;
    this._spark(this.cat.x, this.cat.y - this.cat.h * 0.5);
    this._text(this.cat.x, this.cat.y - this.cat.h, `-${dmg}`, '#E0703F');
    this.hooks.sfx?.('damage');
    if (this.hp <= 0) this._end('LOSE', 'faint');
  }

  damageBox(amount) {
    if (this.phase !== 'FIGHT') return;
    this.box.hp = Math.max(0, this.box.hp - amount);
    this.box.flashT = 0.2;
    this._spark(this.box.x + (Math.random() - 0.5) * 40, this.box.y - 40);
    if (this.box.hp <= 0) this._end('LOSE', 'box');
  }

  _hitMonster(m, dmg) {
    const killed = m.takeDamage(dmg, this.cat.x);
    this._spark(m.center.x, m.center.y);
    this._text(m.x, m.y - m.cellH * PX - 6, `${dmg}`, '#FFF8EC');
    if (killed) {
      this.kills[m.code] += 1;
      this.fishPreview += m.stats.reward_fish;
      this.fx.push({ type: 'fish', x: m.x, y: m.y - 20, vy: -260, t: 0, life: 0.8 });
      this.hooks.sfx?.('pickup');
    }
  }

  // ---------------- 主迴圈 ----------------
  update(dt) {
    this._updateFx(dt);
    if (this.phase === 'COUNTDOWN') {
      this.cat.update(dt, this.input, this.room, { canMove: false });
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'FIGHT'; this.hooks.onFight?.(); }
      return;
    }
    if (this.phase === 'END') {
      this.cat.update(dt, this.input, this.room, { canMove: false });
      for (const m of this.monsters) if (!m.alive) m.update(dt, this);
      this.endT += dt;
      if (this.endT >= 1.4 && !this._reported) { this._reported = true; this.hooks.onEnd?.(this.report()); }
      return;
    }

    this.t += dt;
    // 照後端出怪表生怪
    while (this.queue.length && this.queue[0].t <= this.t) {
      const s = this.queue.shift();
      const stats = this.monsterStats[s.m];
      const sp = this.room.def.monsterSpawns[s.p % this.room.def.monsterSpawns.length];
      if (stats) this.monsters.push(new Monster(stats, this.assets, sp[0], sp[1]));
    }

    this.monsterSpeedMul = this._active('slow') ? (this.skill?.effect.factor || 0.5) : 1;
    this.cat.update(dt, this.input, this.room);
    this._autoAttack(dt);
    this._spinTick(dt);
    if (this.input.consume('skill')) this.useSkill();
    if (this.input.consume('interact')) this.useCarrier();
    if (this.skillCd > 0) this.skillCd -= dt;
    if (this.carrier.cd > 0) this.carrier.cd -= dt;
    if (this.box.flashT > 0) this.box.flashT -= dt;

    for (const m of this.monsters) m.update(dt, this);
    this.monsters = this.monsters.filter((m) => !m.removed);

    if (this.t >= this.duration && this.phase === 'FIGHT') this._end('WIN', 'time');
  }

  _autoAttack(dt) {
    this.atkCd -= dt;
    if (this.atkCd > 0 || this.cat.state === 'FAINT') return;
    // 揮爪範圍內由近到遠，最多同時命中 cleave 隻（AI 補充：爪擊是橫掃）
    const inRange = this.monsters
      .filter((m) => m.alive && m.state !== 'SPAWN')
      .map((m) => ({ m, d: Math.hypot(m.x - this.cat.x, (m.y - this.cat.y) * 1.4) - m.radius }))
      .filter((o) => o.d <= AUTO_RANGE)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.cleave);
    if (!inRange.length) { this.atkCd = 0.1; return; }
    const best = inRange[0].m;
    this.atkCd = this.autoPeriod;
    this.cat.playAttack(best.x);
    const hits = this._active('multiHit') ? (this.skill?.effect.hits || 2) : 1;
    for (const { m } of inRange) for (let i = 0; i < hits; i++) this._hitMonster(m, this.atk);
    this.fx.push({ type: 'slash', x: (this.cat.x + best.x) / 2, y: best.center.y, flip: best.x > this.cat.x, t: 0, life: 0.22 });
    this.hooks.sfx?.('attack');
  }

  _spinTick(dt) {
    if (!this._active('spin')) return;
    this._spinAcc = (this._spinAcc || 0) + dt;
    const tick = (this.skill.effect.tick_ms || 250) / 1000;
    while (this._spinAcc >= tick) {
      this._spinAcc -= tick;
      for (const m of this.monsters) {
        if (m.alive && m.state !== 'SPAWN' && Math.hypot(m.x - this.cat.x, (m.y - this.cat.y) * 1.4) < 150) {
          this._hitMonster(m, Math.max(1, Math.round(this.atk * 0.5)));
        }
      }
    }
  }

  // ---------------- 技能（Space） ----------------
  useSkill() {
    if (!this.skill) { this.hooks.onNotice?.('這場沒有裝備技能'); return; }
    if (this.skillCd > 0 || this.cat.state === 'FAINT') return;
    const e = this.skill.effect, dur = (e.duration_ms || 0) / 1000;
    this.skillCd = this.skill.cooldown_ms / 1000;
    this.stats.skillUses += 1;
    switch (e.type) {
      case 'multi_hit': this.effects.multiHit = this.t + dur; break;
      case 'dodge': this.effects.dodge = this.t + dur; break;
      case 'shield': this.effects.shield = this.t + dur; break;
      case 'invulnerable': this.effects.invuln = this.t + dur; break;
      case 'slow_all': this.effects.slow = this.t + dur; break;
      case 'spin': this.effects.spin = this.t + dur; this._spinAcc = 0; break;
      case 'heal_box':
        this.box.hp = Math.min(this.box.max, this.box.hp + (e.amount || 40));
        this._text(this.box.x, this.box.y - 90, `+${e.amount || 40}`, '#7CC36B');
        break;
      case 'aoe':
        for (const m of this.monsters) {
          if (m.alive && m.state !== 'SPAWN' && Math.hypot(m.x - this.cat.x, (m.y - this.cat.y) * 1.4) < (e.radius || 180)) {
            this._hitMonster(m, Math.round(this.atk * (e.mult || 2)));
          }
        }
        this.fx.push({ type: 'ring', x: this.cat.x, y: this.cat.y - 40, r: e.radius || 180, t: 0, life: 0.35 });
        break;
      case 'dash_cone': {
        const dir = this.cat.facing;
        for (let i = 0; i < 12; i++) this.moveEntity(this.cat, dir * 15, 0);   // 往前飛撲 180px（分段避免穿牆）
        const targets = this.monsters
          .filter((m) => m.alive && m.state !== 'SPAWN' && (m.x - this.cat.x) * dir > -30
                    && Math.hypot(m.x - this.cat.x, (m.y - this.cat.y) * 1.4) < 170)
          .sort((a, b) => Math.abs(a.x - this.cat.x) - Math.abs(b.x - this.cat.x))
          .slice(0, e.targets || 3);
        for (const m of targets) this._hitMonster(m, Math.round(this.atk * (e.mult || 1.5)));
        this.cat.playAttack();
        break;
      }
      default: break;
    }
    this._text(this.cat.x, this.cat.y - this.cat.h - 20, this.skill.name, '#F2C14E');
    this.hooks.onSkill?.(this.skill.code);
  }

  // ---------------- 外出籠（Enter） ----------------
  useCarrier() {
    const c = this.carrier;
    if (!c.ready) { this.hooks.onNotice?.('外出籠：認養滿 48 小時後解鎖'); return; }
    if (c.left <= 0) { this.hooks.onNotice?.('這場的外出籠已經用完了'); return; }
    if (c.cd > 0 || this.hp >= this.maxHp || this.cat.state === 'FAINT') return;
    c.left -= 1; c.cd = c.cooldown_sec;
    const heal = Math.min(c.heal, this.maxHp - this.hp);
    this.hp += heal;
    this.stats.carrierUses += 1;
    this.fx.push({ type: 'heal', x: this.cat.x, y: this.cat.y - this.cat.h * 0.5, t: 0, life: 0.6 });
    this._text(this.cat.x, this.cat.y - this.cat.h, `+${heal}`, '#7CC36B');
    this.hooks.onCarrier?.(heal);
  }

  _end(result, reason) {
    if (this.phase === 'END') return;
    this.phase = 'END';
    this.result = { result, reason };
    if (reason === 'faint') this.cat.faint();
    for (const m of this.monsters) if (m.alive) { m.state = 'DEAD'; m.anim.play('dead', true); }
    this.hooks.onResult?.(result, reason);
  }

  report() {
    return {
      result: this.result.result, reason: this.result.reason,
      box_hp: Math.round(this.box.hp), player_hp: Math.round(this.hp),
      kills: { ...this.kills }, duration_ms: Math.round(this.t * 1000),
      damage_taken: this.damageTaken, ...this.stats,
    };
  }

  // ---------------- 特效 ----------------
  _spark(x, y) { this.fx.push({ type: 'spark', x, y, t: 0, life: 0.25 }); }
  _text(x, y, text, color) { this.fx2.push({ x, y, text, color, t: 0, life: 0.8 }); }
  _updateFx(dt) {
    for (const f of this.fx) { f.t += dt; if (f.type === 'fish') { f.y += f.vy * dt; f.vy += 700 * dt; } }
    for (const f of this.fx2) { f.t += dt; f.y -= 50 * dt; }
    this.fx = this.fx.filter((f) => f.t < f.life);
    this.fx2 = this.fx2.filter((f) => f.t < f.life);
  }

  // ---------------- 繪製 ----------------
  render(ctx) {
    const box = this.box;
    const boxEntity = {
      y: box.y,
      render: (c) => {
        const r = box.hp / box.max, frame = r < 0.2 ? 2 : r < 0.5 ? 1 : 0;
        c.fillStyle = 'rgba(107, 62, 38, 0.22)';
        c.beginPath(); c.ellipse(box.x, box.y - 2, 44, 10, 0, 0, Math.PI * 2); c.fill();
        box.sheet.draw(c, frame, box.x, box.y, false, box.flashT > 0 ? 0.55 : 1);
      },
    };
    this.room.render(ctx, [boxEntity, this.cat, ...this.monsters]);
    if (this._active('shield') || this._active('invuln')) this._drawAura(ctx, this._active('invuln') ? '#2E2E30' : '#8DCFFF');
    if (this._active('spin')) this._drawAura(ctx, '#F6B0B0', 150);
    this._renderFx(ctx);
    this._renderHud(ctx);
  }

  _drawAura(ctx, color, r = 90) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 10);
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(this.cat.x, this.cat.y - this.cat.h * 0.45, r * 0.8, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  _renderFx(ctx) {
    ctx.save();
    for (const f of this.fx) {
      const k = f.t / f.life;
      if (f.type === 'slash') {
        ctx.strokeStyle = '#FFF8EC'; ctx.lineWidth = 9; ctx.lineCap = 'square';
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        const s = f.flip ? 1 : -1;
        ctx.arc(f.x, f.y, 42, (s > 0 ? -1.2 : Math.PI - 0.6) + k * 0.8 * s, (s > 0 ? 0.6 : Math.PI + 1.2) + k * 0.8 * s);
        ctx.stroke();
      } else if (f.type === 'spark') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#F2C14E';
        const r = 6 + k * 18;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          ctx.fillRect(Math.round(f.x + Math.cos(a) * r) - 3, Math.round(f.y + Math.sin(a) * r) - 3, 6, 6);
        }
      } else if (f.type === 'fish') {
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.fillStyle = '#6B3E26'; ctx.fillRect(f.x - 15, f.y - 9, 30, 18);
        ctx.fillStyle = '#8DCFFF'; ctx.fillRect(f.x - 12, f.y - 6, 21, 12);
        ctx.fillStyle = '#6B3E26'; ctx.fillRect(f.x + 9, f.y - 9, 9, 6); ctx.fillRect(f.x + 9, f.y + 3, 9, 6);
      } else if (f.type === 'heal') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#7CC36B';
        for (let i = 0; i < 3; i++) {
          const px2 = f.x - 40 + i * 40, py = f.y - k * 50 - (i % 2) * 20;
          ctx.fillRect(px2 - 3, py - 12, 6, 24); ctx.fillRect(px2 - 12, py - 3, 24, 6);
        }
      } else if (f.type === 'ring') {
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#F2C14E'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.ellipse(f.x, f.y + 40, f.r * (0.4 + k * 0.6), f.r * 0.5 * (0.4 + k * 0.6), 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '900 26px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#3B2A20';
    for (const f of this.fx2) {
      ctx.globalAlpha = 1 - f.t / f.life;
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  _bar(ctx, x, y, w, label, v, max, color) {
    ctx.fillStyle = '#6B3E26'; ctx.fillRect(x - 3, y - 3, w + 6, 40);
    ctx.fillStyle = '#FFF8EC'; ctx.fillRect(x, y, w, 34);
    ctx.fillStyle = '#3B2A20'; ctx.font = '700 18px "Noto Sans TC", "PingFang TC", sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(label, x + 8, y + 17);
    const bx = x + 78, bw = w - 78 - 86;
    ctx.fillStyle = '#6B3E26'; ctx.fillRect(bx - 2, y + 9, bw + 4, 16);
    ctx.fillStyle = '#F3D49C'; ctx.fillRect(bx, y + 11, bw, 12);
    ctx.fillStyle = v / max < 0.3 ? '#E0703F' : color; ctx.fillRect(bx, y + 11, Math.round(bw * Math.max(0, v / max)), 12);
    ctx.fillStyle = '#3B2A20'; ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(v)}/${max}`, x + w - 8, y + 17);
  }

  _renderHud(ctx) {
    ctx.save();
    const domHud = this.hooks.domHud?.();          // 手機直向：計時與血條改由 DOM 顯示
    if (!domHud) {
    // 左：貓咪生命　右：飼料箱
    this._bar(ctx, 18, 18, 380, '生命', this.hp, this.maxHp, '#7CC36B');
    this._bar(ctx, 1280 - 398, 18, 380, '飼料箱', this.box.hp, this.box.max, '#D9894A');
    // 中：倒數
    const left = Math.max(0, this.duration - this.t);
    ctx.fillStyle = '#6B3E26'; ctx.fillRect(560, 12, 160, 78);
    ctx.fillStyle = left <= 10 && this.phase === 'FIGHT' ? '#F6B0B0' : '#FFF8EC'; ctx.fillRect(563, 15, 154, 72);
    ctx.fillStyle = '#3B2A20'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 38px ui-monospace, Menlo, monospace';
    ctx.fillText(fmtClock(left), 640, 42);
    ctx.font = '700 16px "Noto Sans TC", "PingFang TC", sans-serif';
    const k = this.kills.dust + this.kills.hunger + this.kills.mischief;
    ctx.fillText(`擊敗 ${k}　🐟 ${this.fishPreview}`, 640, 74);

    // 技能 / 外出籠 / 效果（桌機顯示按鍵提示）
    const lines = [];
    if (this.skill) lines.push(`${this.hooks.isTouch?.() ? '' : 'Space '}${this.skill.name}${this.skillCd > 0 ? ` ${Math.ceil(this.skillCd)}s` : ' 可用'}`);
    lines.push(`${this.hooks.isTouch?.() ? '' : 'Enter '}外出籠 ${this.carrier.ready ? `×${this.carrier.left}${this.carrier.cd > 0 ? ` ${Math.ceil(this.carrier.cd)}s` : ''}` : '未解鎖'}`);
    const act = [['multiHit', '連擊'], ['dodge', '閃避'], ['shield', '護盾'], ['invuln', '無敵'], ['slow', '減速'], ['spin', '旋風']]
      .filter(([n]) => this._active(n)).map(([n, l]) => `${l} ${Math.ceil(this.effects[n] - this.t)}s`);
    if (act.length) lines.push(act.join('　'));
    ctx.font = '700 17px "Noto Sans TC", "PingFang TC", sans-serif';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      const w = ctx.measureText(l).width + 20;
      ctx.fillStyle = 'rgba(59, 42, 32, 0.78)'; ctx.fillRect(18, 66 + i * 30, w, 26);
      ctx.fillStyle = '#FFF8EC'; ctx.fillText(l, 28, 79 + i * 30);
    });
    }

    // 開場倒數
    if (this.phase === 'COUNTDOWN') {
      const n = Math.ceil(this.countdown);
      ctx.font = '900 140px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center';
      ctx.lineWidth = 14; ctx.strokeStyle = '#6B3E26'; ctx.fillStyle = '#FFF8EC';
      ctx.strokeText(String(n), 640, 380); ctx.fillText(String(n), 640, 380);
      ctx.font = '900 34px "Noto Sans TC", "PingFang TC", sans-serif'; ctx.lineWidth = 8;
      ctx.strokeText('守護飼料箱 60 秒！', 640, 480); ctx.fillText('守護飼料箱 60 秒！', 640, 480);
    } else if (this.phase === 'FIGHT' && this.t < 0.8) {
      ctx.font = '900 96px "Noto Sans TC", "PingFang TC", sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - this.t / 0.8; ctx.lineWidth = 12; ctx.strokeStyle = '#6B3E26'; ctx.fillStyle = '#F2C14E';
      ctx.strokeText('開始！', 640, 380); ctx.fillText('開始！', 640, 380);
    } else if (this.phase === 'END') {
      const win = this.result.result === 'WIN';
      const msg = win ? '守護成功！' : this.result.reason === 'box' ? '飼料箱被吃光了…' : '貓咪累倒了…';
      ctx.globalAlpha = Math.min(1, this.endT * 2);
      ctx.font = '900 80px "Noto Sans TC", "PingFang TC", sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 12; ctx.strokeStyle = '#6B3E26'; ctx.fillStyle = win ? '#F2C14E' : '#FFF8EC';
      ctx.strokeText(msg, 640, 380); ctx.fillText(msg, 640, 380);
    }
    ctx.restore();
  }

  renderDebug(ctx) {
    this.room.renderDebug(ctx);
    ctx.save(); ctx.lineWidth = 2;
    const f = this.cat.feetBox; ctx.strokeStyle = '#ffd60a'; ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = 'rgba(255,214,10,0.5)';
    ctx.beginPath(); ctx.ellipse(this.cat.x, this.cat.y, AUTO_RANGE, AUTO_RANGE / 1.4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '14px ui-monospace, monospace'; ctx.fillStyle = '#fff';
    for (const m of this.monsters) {
      const b = m.feetBoxAt(m.x, m.y); ctx.strokeStyle = '#ff3b30'; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillText(`${m.state} ${m.hp}`, m.x - 30, m.y + 16);
    }
    ctx.restore();
  }

  debugInfo() {
    return {
      Room: this.room.id, Phase: this.phase, Time: this.t.toFixed(1),
      Player: `${this.cat.x.toFixed(0)}, ${this.cat.y.toFixed(0)} HP ${this.hp}`,
      Monsters: `${this.monsters.filter((m) => m.alive).length} alive / ${this.queue.length} queued`,
      Kills: JSON.stringify(this.kills),
    };
  }
}
