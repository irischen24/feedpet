// =====================================================================
// Monster — 數值來自 Supabase monsters 表（HP、攻擊、速度、範圍、目標）
// AI 狀態：SPAWN → PATROL / CHASE → ATTACK → HIT → DEAD
//   灰塵怪 patrol_chase：閒晃，玩家進入 280px 就追擊
//   飢餓怪 seek_box：直衝飼料箱；被打後 2 秒內改追玩家
//   搗蛋怪 zigzag_dash：之字形衝向玩家，撞完後退 0.6 秒
// =====================================================================
import { PX } from './roomArt.js';
import { SpriteSheet, Animator, MONSTER_ANIMS, MONSTER_CELL } from '../engine/sprites.js';

const AGGRO_RANGE = 280;
const ATTACK_COOLDOWN = 1.2;
export const TUNING = { boxCooldown: 2.0 };   // 啃飼料箱的間隔（平衡測試後調整）

let nextId = 1;

export class Monster {
  constructor(stats, assets, x, y) {
    this.id = nextId++;
    this.code = stats.code;
    this.stats = stats;
    this.hp = stats.hp;
    this.x = x; this.y = y;
    this.state = 'SPAWN';
    this.spawnT = 0.35;
    this.t = Math.random() * 10;
    this.cooldown = 0.6;
    this.hitApplied = false;
    this.aggroT = 0;
    this.retreatT = 0;
    this.stunT = 0;
    this.wander = null; this.wanderT = 0;
    this.facing = -1;
    this.removed = false;
    const cell = MONSTER_CELL[this.code];
    this.cellW = cell.w; this.cellH = cell.h;
    this.sheets = {};
    for (const a of Object.keys(MONSTER_ANIMS)) {
      this.sheets[a] = new SpriteSheet(assets.get(`monster_${this.code}_${a}`), cell.w, cell.h);
    }
    this.anim = new Animator(MONSTER_ANIMS);
    this.anim.play('move');
    this.radius = cell.w * PX * 0.32;
  }

  feetBoxAt(x, y) { const w = this.cellW * PX * 0.5; return { x: x - w / 2, y: y - 10, w, h: 10 }; }
  get alive() { return this.state !== 'DEAD'; }
  get center() { return { x: this.x, y: this.y - this.cellH * PX * 0.4 }; }

  takeDamage(amount, fromX) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0; this.state = 'DEAD'; this.anim.play('dead', true);
      return true;                                            // 擊敗
    }
    this.state = 'HIT'; this.stunT = 0.22; this.anim.play('hit', true);
    const dir = this.x >= fromX ? 1 : -1;
    this.knock = dir * 260;                                   // 擊退
    if (this.code === 'hunger') this.aggroT = 2;
    return false;
  }

  update(dt, battle) {
    this.t += dt;
    this.anim.update(dt);
    if (this.state === 'DEAD') { if (this.anim.done) this.removed = true; return; }
    if (this.state === 'SPAWN') { this.spawnT -= dt; if (this.spawnT <= 0) this.state = 'PATROL'; return; }
    this.cooldown -= dt;
    if (this.aggroT > 0) this.aggroT -= dt;
    if (this.retreatT > 0) this.retreatT -= dt;

    if (this.state === 'HIT') {
      this.stunT -= dt;
      if (this.knock) { battle.moveEntity(this, this.knock * dt, 0); this.knock *= 0.8; }
      if (this.stunT <= 0) { this.state = 'CHASE'; this.knock = 0; this.anim.play('move'); }
      return;
    }

    const cat = battle.cat;
    const targetIsBox = this.stats.target === 'food_box' && this.aggroT <= 0;

    if (this.state === 'ATTACK') {
      if (!this.hitApplied && this.anim.frame >= MONSTER_ANIMS.attack.hit) {
        this.hitApplied = true;
        if (targetIsBox) { if (battle.distToBox(this) <= this.stats.range + 14) battle.damageBox(this.stats.attack, this); }
        else if (this._distTo(cat) <= this.stats.range + 40) battle.damageCat(this.stats.attack, this);
      }
      if (this.anim.done) {
        this.state = 'CHASE'; this.anim.play('move');
        if (this.code === 'mischief') this.retreatT = 0.6;
      }
      return;
    }

    // 決定移動方向
    const speed = this.stats.speed * battle.monsterSpeedMul;
    let tx, ty, inRange;
    if (targetIsBox) {
      const b = battle.box.center;
      tx = b.x; ty = b.y;
      inRange = battle.distToBox(this) <= this.stats.range + 10;
    } else if (this.code === 'dust' && this._distTo(cat) > AGGRO_RANGE) {
      this.state = 'PATROL';
      this.wanderT -= dt;
      if (!this.wander || this.wanderT <= 0) {
        this.wander = { x: 120 + Math.random() * 1040, y: 280 + Math.random() * 400 }; this.wanderT = 2;
      }
      tx = this.wander.x; ty = this.wander.y; inRange = false;
    } else {
      this.state = 'CHASE';
      tx = cat.x; ty = cat.y;
      inRange = this._distTo(cat) <= this.stats.range + 40;
    }

    if (inRange && this.cooldown <= 0 && cat.state !== 'FAINT') {
      this.state = 'ATTACK'; this.hitApplied = false; this.cooldown = targetIsBox ? TUNING.boxCooldown : ATTACK_COOLDOWN;
      this.anim.play('attack', true);
      this.facing = tx > this.x ? 1 : -1;
      return;
    }
    if (inRange) return;                                       // 等冷卻，停在原地

    let dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (this.retreatT > 0) { dx = -dx; dy = -dy; }
    if (this.code === 'mischief' && this.retreatT <= 0) {    // 之字形：加上垂直方向的擺動
      const wob = Math.sin(this.t * 6) * 0.8;
      const ndx = dx - dy * wob, ndy = dy + dx * wob, n = Math.hypot(ndx, ndy) || 1;
      dx = ndx / n; dy = ndy / n;
    }
    battle.moveEntity(this, dx * speed * dt, dy * speed * dt);
    if (Math.abs(dx) > 0.1) this.facing = dx > 0 ? 1 : -1;
    this.anim.play('move');
  }

  _distTo(cat) { return Math.hypot(cat.x - this.x, (cat.y - this.y) * 1.4); }

  render(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.state !== 'DEAD') {
      ctx.fillStyle = 'rgba(59, 42, 32, 0.22)';
      ctx.beginPath(); ctx.ellipse(x, y - 2, this.cellW * PX * 0.3, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    const alpha = this.state === 'SPAWN' ? 1 - this.spawnT / 0.35 : 1;
    const sheetName = this.state === 'DEAD' ? 'dead' : this.state === 'HIT' ? 'hit' : this.state === 'ATTACK' ? 'attack' : 'move';
    this.sheets[sheetName].draw(ctx, this.anim.frame, x, y, this.facing === 1, alpha);

    if (this.alive && this.hp < this.stats.hp) {              // 受傷後才顯示血條
      const w = this.cellW * PX * 0.7, top = y - this.cellH * PX - 10;
      ctx.fillStyle = '#3B2A20'; ctx.fillRect(x - w / 2 - 2, top - 2, w + 4, 10);
      ctx.fillStyle = '#E0703F'; ctx.fillRect(x - w / 2, top, w * (this.hp / this.stats.hp), 6);
    }
  }
}
