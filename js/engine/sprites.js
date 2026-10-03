// =====================================================================
// Sprite Sheet 規格（與《美術素材規格》文件一致）
//   * 橫向排列、每格同尺寸、原生像素（遊戲 ×3 放大）
//   * 每格「腳底中心」= 格子底邊中央
//   * 角色、怪物一律面向左前方，往右由程式翻轉
// 你上傳到 GitHub 的圖會優先使用；不存在時用內建版本。
// =====================================================================
import { PX } from '../game/roomArt.js';

export const CAT_CODES = ['orange', 'tabby', 'black', 'calico', 'ragdoll'];
export const MONSTER_CODES = ['dust', 'hunger', 'mischief'];

export const CAT_CELL = { w: 64, h: 56 };
export const CAT_ANIMS = {
  idle:   { frames: 4, fps: 4,  loop: true },
  walk:   { frames: 6, fps: 10, loop: true },
  attack: { frames: 4, fps: 14, loop: false, hit: 2 },
  hurt:   { frames: 2, fps: 8,  loop: false },
  faint:  { frames: 4, fps: 6,  loop: false },
  eat:    { frames: 3, fps: 4,  loop: true },
  skill:  { frames: 4, fps: 12, loop: false },
};

export const MONSTER_CELL = { dust: { w: 32, h: 28 }, hunger: { w: 36, h: 32 }, mischief: { w: 32, h: 32 } };
export const MONSTER_ANIMS = {
  move:   { frames: 4, fps: 8,  loop: true },
  attack: { frames: 3, fps: 10, loop: false, hit: 1 },
  hit:    { frames: 2, fps: 10, loop: false },
  dead:   { frames: 5, fps: 12, loop: false },
};

// 可選素材：存在就用，不存在不影響遊戲
export function optionalManifest() {
  const m = {};
  for (const c of CAT_CODES) for (const a of Object.keys(CAT_ANIMS)) m[`cat_${c}_${a}`] = `assets/sprites/cats/cat_${c}_${a}.png`;
  for (const c of MONSTER_CODES) for (const a of Object.keys(MONSTER_ANIMS)) m[`monster_${c}_${a}`] = `assets/sprites/monsters/monster_${c}_${a}.png`;
  m.file_arena_yard = 'assets/rooms/arena_yard.png';
  m.file_arena_storage = 'assets/rooms/arena_storage.png';
  m.file_prop_food_box = 'assets/props/prop_food_box.png';
  m.file_prop_crate = 'assets/props/prop_crate.png';
  return m;
}

export class SpriteSheet {
  constructor(img, cellW, cellH) {
    this.img = img; this.w = cellW; this.h = cellH;
    this.frames = Math.max(1, Math.floor(img.width / cellW));
  }

  // 圖片尺寸不符規格時回傳錯誤訊息（避免把排錯的圖載進遊戲）
  static validate(img, cellW, cellH, frames) {
    if (img.height !== cellH) return `高度應為 ${cellH}，實際 ${img.height}`;
    if (img.width !== cellW * frames) return `寬度應為 ${cellW}×${frames}=${cellW * frames}，實際 ${img.width}`;
    return null;
  }

  // (x, y) = 腳底中心（邏輯座標）
  draw(ctx, frame, x, y, flip = false, alpha = 1) {
    const f = Math.min(Math.max(0, frame | 0), this.frames - 1);
    const dw = this.w * PX, dh = this.h * PX;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(this.img, f * this.w, 0, this.w, this.h, -Math.round(dw / 2), -dh, dw, dh);
    ctx.restore();
  }
}

export class Animator {
  constructor(specs) { this.specs = specs; this.name = null; this.t = 0; }
  play(name, restart = false) {
    if (this.name === name && !restart) return;
    this.name = name; this.t = 0;
  }
  update(dt) { this.t += dt; }
  get spec() { return this.specs[this.name]; }
  get frame() {
    const s = this.spec; if (!s) return 0;
    const f = Math.floor(this.t * s.fps);
    return s.loop ? f % s.frames : Math.min(f, s.frames - 1);
  }
  get done() { const s = this.spec; return !!s && !s.loop && this.t * s.fps >= s.frames; }
}
