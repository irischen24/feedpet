// =====================================================================
// Cat（玩家角色）
//   邏輯位置 (x, y) = 腳底中心。速度固定 220 px/s（所有裝置相同）。
//   原圖面向左前方；往右走時水平翻轉。
//   動畫：Idle（呼吸：上半身下沉 1 美術像素）、Walk（步伐上下彈跳）。
//   完整走路逐格圖尚未提供，這是依原圖做的過渡動畫（見開發說明）。
// =====================================================================
import { PX } from './roomArt.js';

export const CAT_SPEED = 220;
const FEET = { w: 60, h: 14 };

export class Cat {
  constructor(assets, adoption, pos = { x: 640, y: 600 }) {
    this.assets = assets;
    this.x = pos.x; this.y = pos.y;
    this.facing = -1;                 // -1 = 原圖方向（左），1 = 翻轉（右）
    this.state = 'IDLE';
    this.t = 0;
    this.bubble = null;               // { text, until }
    this.setAdoption(adoption);
  }

  setAdoption(adoption) {
    this.adoption = adoption;
    this.img = this.assets.get(adoption.sprite_key);
    this.w = this.img.width * PX;
    this.h = this.img.height * PX;
  }

  feetBoxAt(x, y) { return { x: x - FEET.w / 2, y: y - FEET.h, w: FEET.w, h: FEET.h }; }
  get feetBox() { return this.feetBoxAt(this.x, this.y); }
  get bodyBox() { return { x: this.x - this.w * 0.36, y: this.y - this.h * 0.85, w: this.w * 0.72, h: this.h * 0.8 }; }

  say(text, seconds = 4) { this.bubble = { text, until: this.t + seconds }; }

  update(dt, input, room) {
    this.t += dt;
    let v = input.moveVector();
    if (!v.x && !v.y && input.tapTarget) {
      const dx = input.tapTarget.x - this.x, dy = input.tapTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) input.tapTarget = null; else v = { x: dx / d, y: dy / d };
    }
    if (v.x || v.y) {
      const bx = this.x, by = this.y;
      const { hitX, hitY } = room.collision.move(this, v.x * CAT_SPEED * dt, v.y * CAT_SPEED * dt);
      // 點地板移動：被障礙物擋住、0.25 秒沒有前進就放棄，避免原地頂牆
      const moved = Math.hypot(this.x - bx, this.y - by);
      this.stuck = moved < CAT_SPEED * dt * 0.2 ? (this.stuck || 0) + dt : 0;
      if (input.tapTarget && ((hitX && hitY) || this.stuck > 0.25)) { input.tapTarget = null; this.stuck = 0; }
      if (v.x < -0.15) this.facing = -1; else if (v.x > 0.15) this.facing = 1;
      this.state = 'WALK';
    } else {
      this.state = 'IDLE';
    }
  }

  render(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    ctx.fillStyle = 'rgba(107, 62, 38, 0.25)';
    ctx.beginPath(); ctx.ellipse(x, y - 3, this.w * 0.36, 12, 0, 0, Math.PI * 2); ctx.fill();

    const bob = this.state === 'WALK' ? -PX * (Math.floor(this.t * 9) % 2) : 0;
    const breathe = this.state === 'IDLE' && Math.floor(this.t / 0.7) % 2 === 1;
    const iw = this.img.width, ih = this.img.height;

    ctx.save();
    ctx.translate(x, y + bob);
    if (this.facing === 1) ctx.scale(-1, 1);
    const left = -Math.round(this.w / 2);
    if (breathe) {
      const legRows = 14;                            // 腳不動，上半身下沉 1 美術像素
      ctx.drawImage(this.img, 0, ih - legRows, iw, legRows, left, -legRows * PX, this.w, legRows * PX);
      ctx.drawImage(this.img, 0, 0, iw, ih - legRows, left, -this.h + PX, this.w, (ih - legRows) * PX);
    } else {
      ctx.drawImage(this.img, left, -this.h, this.w, this.h);
    }
    ctx.restore();

    if (this.bubble && this.t < this.bubble.until) this._renderBubble(ctx, x, y - this.h - 16);
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
