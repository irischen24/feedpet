// =====================================================================
// Cat（玩家角色）
//   邏輯位置 (x, y) = 腳底中心。速度固定 220 px/s（所有裝置相同）。
//   有 assets/sprites/cats/cat_<代號>_<動作>.png 時播放 Sprite Sheet；
//   沒有時用原圖 + 程式動畫（呼吸、彈跳、撲擊位移、閃爍、趴下）。
// =====================================================================
import { PX } from './roomArt.js';
import { SpriteSheet, Animator, CAT_ANIMS, CAT_CELL } from '../engine/sprites.js';

export const CAT_SPEED = 220;
const FEET = { w: 60, h: 14 };

export class Cat {
  constructor(assets, adoption, pos = { x: 640, y: 600 }) {
    this.assets = assets;
    this.x = pos.x; this.y = pos.y;
    this.facing = -1;                 // -1 = 原圖方向（左），1 = 翻轉（右）
    this.state = 'IDLE';              // IDLE / WALK / ATTACK / HURT / FAINT
    this.t = 0;
    this.actionT = 0;
    this.flashT = 0;
    this.bubble = null;
    this.anim = new Animator(CAT_ANIMS);
    this.setAdoption(adoption);
  }

  setAdoption(adoption) {
    this.adoption = adoption;
    this.code = adoption.sprite_key.replace(/^cat_/, '');
    this.img = this.assets.get(adoption.sprite_key);
    this.w = this.img.width * PX;
    this.h = this.img.height * PX;
    this.sheets = {};
    for (const name of Object.keys(CAT_ANIMS)) {
      const key = `cat_${this.code}_${name}`;
      if (this.assets.has(key)) this.sheets[name] = new SpriteSheet(this.assets.get(key), CAT_CELL.w, CAT_CELL.h);
    }
  }

  feetBoxAt(x, y) { return { x: x - FEET.w / 2, y: y - FEET.h, w: FEET.w, h: FEET.h }; }
  get feetBox() { return this.feetBoxAt(this.x, this.y); }
  get bodyBox() { return { x: this.x - this.w * 0.36, y: this.y - this.h * 0.85, w: this.w * 0.72, h: this.h * 0.8 }; }
  get center() { return { x: this.x, y: this.y - this.h * 0.4 }; }

  say(text, seconds = 4) { this.bubble = { text, until: this.t + seconds }; }

  // ---- 戰鬥動作（只負責動畫；傷害計算在 BattleScene） ----
  playAttack(targetX) {
    if (this.state === 'FAINT') return;
    if (targetX !== undefined) this.facing = targetX > this.x ? 1 : -1;
    this.state = 'ATTACK'; this.actionT = 0.28; this.anim.play('attack', true);
  }
  playHurt() {
    if (this.state === 'FAINT') return;
    this.state = 'HURT'; this.actionT = 0.25; this.flashT = 0.6; this.anim.play('hurt', true);
  }
  faint() { this.state = 'FAINT'; this.actionT = 0; this.anim.play('faint', true); this.bubble = null; }

  update(dt, input, room, { canMove = true, speedMul = 1 } = {}) {
    this.t += dt;
    this.anim.update(dt);
    if (this.flashT > 0) this.flashT -= dt;
    if (this.state === 'FAINT') return;
    if (this.actionT > 0) { this.actionT -= dt; if (this.actionT <= 0) this.state = 'IDLE'; }

    let v = canMove ? input.moveVector() : { x: 0, y: 0 };
    if (canMove && !v.x && !v.y && input.tapTarget) {
      const dx = input.tapTarget.x - this.x, dy = input.tapTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) input.tapTarget = null; else v = { x: dx / d, y: dy / d };
    }
    const busy = this.state === 'ATTACK' || this.state === 'HURT';
    if (v.x || v.y) {
      const bx = this.x, by = this.y, sp = CAT_SPEED * speedMul;
      const { hitX, hitY } = room.collision.move(this, v.x * sp * dt, v.y * sp * dt);
      // 點地板移動：被擋住、0.25 秒沒前進就放棄
      const moved = Math.hypot(this.x - bx, this.y - by);
      this.stuck = moved < sp * dt * 0.2 ? (this.stuck || 0) + dt : 0;
      if (input.tapTarget && ((hitX && hitY) || this.stuck > 0.25)) { input.tapTarget = null; this.stuck = 0; }
      if (!busy) {
        if (v.x < -0.15) this.facing = -1; else if (v.x > 0.15) this.facing = 1;
        this.state = 'WALK'; this.anim.play('walk');
      }
    } else if (!busy) {
      this.state = 'IDLE'; this.anim.play('idle');
    }
  }

  render(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    ctx.fillStyle = 'rgba(107, 62, 38, 0.25)';
    ctx.beginPath(); ctx.ellipse(x, y - 3, this.w * 0.36, 12, 0, 0, Math.PI * 2); ctx.fill();

    const blink = this.flashT > 0 && Math.floor(this.flashT * 16) % 2 === 0;   // 受傷無敵時間閃爍
    const alpha = blink ? 0.35 : 1;
    const sheet = this.anim.name && this.sheets[this.anim.name];
    if (sheet) sheet.draw(ctx, this.anim.frame, x, y, this.facing === 1, alpha);
    else this._renderFallback(ctx, x, y, alpha);

    if (this.state === 'FAINT' && !this.sheets.faint) this._zzz(ctx, x, y);
    if (this.bubble && this.t < this.bubble.until) this._renderBubble(ctx, x, y - this.h - 16);
  }

  _renderFallback(ctx, x, y, alpha) {
    const iw = this.img.width, ih = this.img.height;
    ctx.save();
    ctx.globalAlpha = alpha;
    let ox = 0, oy = 0;
    if (this.state === 'WALK') oy = -PX * (Math.floor(this.t * 9) % 2);
    if (this.state === 'ATTACK') ox = PX * 3 * this.facing;               // 往目標撲 3 格
    if (this.state === 'HURT') ox = -PX * 2 * this.facing;               // 被打退 2 格
    ctx.translate(x + ox, y + oy);
    if (this.facing === 1) ctx.scale(-1, 1);
    const left = -Math.round(this.w / 2);
    if (this.state === 'FAINT') {                                          // 趴下：壓成 60% 高
      const fh = Math.round(ih * 0.6) * PX;
      ctx.drawImage(this.img, left - PX * 2, -fh, this.w + PX * 4, fh);
    } else if (this.state === 'IDLE' && Math.floor(this.t / 0.7) % 2 === 1) {
      const legRows = 14;                                                  // 呼吸：上半身下沉 1 格
      ctx.drawImage(this.img, 0, ih - legRows, iw, legRows, left, -legRows * PX, this.w, legRows * PX);
      ctx.drawImage(this.img, 0, 0, iw, ih - legRows, left, -this.h + PX, this.w, (ih - legRows) * PX);
    } else {
      ctx.drawImage(this.img, left, -this.h, this.w, this.h);
    }
    ctx.restore();
  }

  _zzz(ctx, x, y) {
    const k = Math.floor(this.t * 2) % 3;
    ctx.save();
    ctx.font = '900 28px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#FFF8EC'; ctx.strokeStyle = '#6B3E26'; ctx.lineWidth = 6;
    for (let i = 0; i <= k; i++) {
      const tx = x + 30 + i * 18, ty = y - this.h * 0.6 - i * 22;
      ctx.strokeText('Z', tx, ty); ctx.fillText('Z', tx, ty);
    }
    ctx.restore();
  }

  _renderBubble(ctx, cx, bottom) {
    ctx.save();
    ctx.font = '700 24px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    const lines = wrap(ctx, this.bubble.text, 360);
    const lh = 32, pad = 14;
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
    const h = lines.length * lh + pad * 2 - 6;
    const bx = Math.round(Math.min(Math.max(cx - w / 2, 12), 1268 - w));
    const by = Math.max(12, bottom - h);
    ctx.fillStyle = '#6B3E26';
    ctx.fillRect(bx - 3, by - 3, w + 6, h + 6);
    ctx.fillRect(cx - 9, by + h, 18, 12);
    ctx.fillStyle = '#FFF8EC';
    ctx.fillRect(bx, by, w, h);
    ctx.fillRect(cx - 6, by + h, 12, 6);
    ctx.fillStyle = '#3B2A20';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad - 2 + i * lh));
    ctx.restore();
  }
}

function wrap(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const ch of String(text)) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
