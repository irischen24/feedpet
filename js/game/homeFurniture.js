// =====================================================================
// 房間家具：素材建立、擺放資料 → Room props、主題背景、裝飾模式
//   擺放資料格式與後端 save_room_layout 相同：
//   [{ item_code, x, y, flipped }]，(x, y) = 腳底中心（邏輯座標）
//   家具旋轉 = 左右翻轉（一點透視的正面視角）
// =====================================================================
import { PX, ART_W, ART_H, drawDoor } from './roomArt.js';
import { FURNITURE_SIZE, WALKABLE_FURNITURE, drawFurnitureSheet, drawDecor, drawIcon } from './furnitureArt.js';
import { pointInPolygon } from '../engine/collision.js';
import { ROOM_DEFS } from './room.js';

export const FURNITURE_CODES = Object.keys(FURNITURE_SIZE);
export const DECOR_CODES = ['floor_dark_wood', 'wallpaper_stripe'];
const ICON_CODES = ['fish', 'food_basic', 'food_can', 'food_treat', 'med_spot', 'med_ear', 'med_heartworm',
  'card_keep_growth', 'carrier', ...FURNITURE_CODES, ...DECOR_CODES];

// 可選上傳檔
export function furnitureManifest() {
  const m = {};
  for (const c of FURNITURE_CODES) m[`file_furn_${c}`] = `assets/furniture/furn_${c}.png`;
  for (const c of DECOR_CODES) m[`file_decor_${c}`] = `assets/decor/decor_${c}.png`;
  for (const c of ICON_CODES) m[`file_icon_${c}`] = `assets/icons/icon_${c}.png`;
  return m;
}

const iconUrls = new Map();
export function buildFurnitureAssets(assets, warn) {
  for (const c of FURNITURE_CODES) {
    const [w, h] = FURNITURE_SIZE[c], frames = c === 'litter_box' ? 2 : 1;
    const f = `file_furn_${c}`;
    const ok = assets.has(f) && assets.get(f).width === w * frames && assets.get(f).height === h;
    if (assets.has(f) && !ok) warn(`furn_${c}.png: 應為 ${w * frames}×${h}`);
    assets.set(`furn_${c}`, ok ? assets.get(f) : drawFurnitureSheet(c));
  }
  const decorSize = { floor_dark_wood: [427, 97], wallpaper_stripe: [427, 143] };
  for (const c of DECOR_CODES) {
    const f = `file_decor_${c}`, [w, h] = decorSize[c];
    const ok = assets.has(f) && assets.get(f).width === w && assets.get(f).height === h;
    if (assets.has(f) && !ok) warn(`decor_${c}.png: 應為 ${w}×${h}`);
    assets.set(`decor_${c}`, ok ? assets.get(f) : drawDecor(c));
  }
  for (const c of ICON_CODES) {
    const f = `file_icon_${c}`;
    if (assets.has(f)) { iconUrls.set(c, assets.get(f).src); continue; }
    const big = document.createElement('canvas'); big.width = 48; big.height = 48;
    const g = big.getContext('2d'); g.imageSmoothingEnabled = false;
    if (FURNITURE_SIZE[c]) {                          // 家具圖示：取（你上傳的）家具圖第 1 格等比縮放
      const src = assets.get(`furn_${c}`), [w, h] = FURNITURE_SIZE[c];
      const k = Math.min(44 / w, 44 / h, 4), dw = Math.round(w * k), dh = Math.round(h * k);
      g.drawImage(src, 0, 0, w, h, Math.round((48 - dw) / 2), Math.round((48 - dh) / 2), dw, dh);
    } else {
      g.drawImage(drawIcon(c), 0, 0, 48, 48);         // 放大 2 倍後轉成 data URL 給 DOM 使用
    }
    iconUrls.set(c, big.toDataURL());
  }
}
export function iconUrl(code) { return iconUrls.get(code) || iconUrls.get('fish'); }

// 依主題組合房間背景（原圖 + 壁紙 + 地板 + 門）
export function composeHomeBg(assets, theme = {}) {
  const c = document.createElement('canvas'); c.width = ART_W; c.height = ART_H;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(assets.get('room_home'), 0, 0);
  if (theme.wallpaper && assets.has(`decor_${theme.wallpaper}`)) g.drawImage(assets.get(`decor_${theme.wallpaper}`), 0, 0);
  if (theme.floor && assets.has(`decor_${theme.floor}`)) g.drawImage(assets.get(`decor_${theme.floor}`), 0, 143);
  g.drawImage(drawDoor(70), 316, 73);
  return c;
}

// 擺放資料 → Room props（含碰撞與貓砂盆髒污狀態）
export function furnitureProps(layout, assets, { litterDirty = false } = {}) {
  return layout.map((f, i) => {
    const [w, h] = FURNITURE_SIZE[f.item_code] || [16, 16];
    const pw = w * PX, ph = h * PX;
    const walk = WALKABLE_FURNITURE.has(f.item_code);
    return {
      id: `furn_${i}`, item_code: f.item_code, image: assets.get(`furn_${f.item_code}`), srcW: w,
      frame: f.item_code === 'litter_box' && litterDirty ? 1 : 0,
      x: f.x, y: f.y, w: pw, h: ph, flipped: !!f.flipped, flat: f.item_code === 'rug_round',
      solid: walk ? null : { x: f.x - pw * 0.4, y: f.y - Math.min(18, ph * 0.5), w: pw * 0.8, h: Math.min(18, ph * 0.5) },
    };
  });
}

// =====================================================================
// 裝飾模式：拖曳、翻轉、收回、新增；儲存時交給後端驗證數量與位置
// =====================================================================
export class DecorateController {
  constructor({ canvas, scaler, scene, assets, layout, onChange }) {
    this.canvas = canvas; this.scaler = scaler; this.scene = scene; this.assets = assets;
    this.layout = layout.map((f) => ({ ...f }));
    this.selected = -1;
    this.drag = null;
    this.onChange = onChange;
    this.walkable = ROOM_DEFS.home.walkable;
    this._down = this._down.bind(this); this._move = this._move.bind(this); this._up = this._up.bind(this);
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointercancel', this._up);
    this.apply();
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._down);
    this.canvas.removeEventListener('pointermove', this._move);
    this.canvas.removeEventListener('pointerup', this._up);
    this.canvas.removeEventListener('pointercancel', this._up);
  }

  apply() {
    this.scene.room.setDynamicProps(furnitureProps(this.layout, this.assets));
    this.onChange?.(this);
  }

  _rect(f) {
    const [w, h] = FURNITURE_SIZE[f.item_code];
    return { x: f.x - (w * PX) / 2, y: f.y - h * PX, w: w * PX, h: h * PX };
  }

  _hit(p) {        // 由前往後找（y 越大越靠前；地毯最後）
    const order = this.layout.map((f, i) => i)
      .sort((a, b) => (this.layout[b].item_code === 'rug_round' ? -1 : this.layout[b].y) - (this.layout[a].item_code === 'rug_round' ? -1 : this.layout[a].y));
    for (const i of order) { const r = this._rect(this.layout[i]); if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i; }
    return -1;
  }

  _down(e) {
    e.preventDefault();
    const p = this.scaler.toLogical(e.clientX, e.clientY);
    const i = this._hit(p);
    this.selected = i;
    if (i >= 0) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, dx: this.layout[i].x - p.x, dy: this.layout[i].y - p.y };
    }
    this.onChange?.(this);
  }

  _move(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const p = this.scaler.toLogical(e.clientX, e.clientY);
    const f = this.layout[this.selected];
    const nx = Math.round(p.x + this.drag.dx), ny = Math.round(p.y + this.drag.dy);
    // 腳底必須在地板範圍內（和後端一樣限制在 0～1280 / 0～720）
    if (pointInPolygon(nx, ny - 2, this.walkable)) { f.x = nx; f.y = ny; this.apply(); }
    else if (pointInPolygon(nx, f.y - 2, this.walkable)) { f.x = nx; this.apply(); }
    else if (pointInPolygon(f.x, ny - 2, this.walkable)) { f.y = ny; this.apply(); }
  }

  _up(e) { if (this.drag && e.pointerId === this.drag.id) this.drag = null; }

  add(code) {
    const spots = [[640, 600], [480, 560], [800, 560], [400, 660], [880, 660], [640, 500]];
    const [x, y] = spots[this.layout.length % spots.length];
    this.layout.push({ item_code: code, x, y, flipped: false });
    this.selected = this.layout.length - 1;
    this.apply();
  }
  flip() { if (this.selected >= 0) { const f = this.layout[this.selected]; f.flipped = !f.flipped; this.apply(); } }
  remove() { if (this.selected >= 0) { this.layout.splice(this.selected, 1); this.selected = -1; this.apply(); } }
  placedCount(code) { return this.layout.filter((f) => f.item_code === code).length; }

  renderOverlay(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(141, 207, 255, 0.9)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); this.walkable.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    if (this.selected >= 0) {
      const r = this._rect(this.layout[this.selected]);
      ctx.strokeStyle = '#F2C14E'; ctx.lineWidth = 4; ctx.setLineDash([]);
      ctx.strokeRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
    }
    ctx.restore();
  }
}
