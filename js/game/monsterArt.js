// =====================================================================
// 內建怪物 Sprite Sheet（依《美術素材規格》的格子尺寸與格數）
//   灰塵怪 dust 32×28、飢餓怪 hunger 36×32、搗蛋怪 mischief 32×32
//   動作：move 4、attack 3、hit 2、dead 5
//   外框由程式自動描 1 格黑邊，和貓咪原圖一致
// 你上傳 assets/sprites/monsters/monster_<代號>_<動作>.png 後會取代這些。
// =====================================================================
import { MONSTER_CELL, MONSTER_ANIMS } from '../engine/sprites.js';

const OUT = '#141414';

function cell(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
const px = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };

function fillEllipse(g, cx, cy, rx, ry, col, jitter = null) {
  g.fillStyle = col;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const a = Math.atan2(y - cy, x - cx);
      const j = jitter ? jitter(a) : 0;
      const nx = (x + 0.5 - cx) / (rx + j), ny = (y + 0.5 - cy) / (ry + j);
      if (nx * nx + ny * ny <= 1) g.fillRect(x, y, 1, 1);
    }
  }
}

// 對不透明區域外圍描 1 格邊（4 鄰接）
function outline(g, w, h, col = OUT) {
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const marks = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push([x, y]);
  }
  g.fillStyle = col;
  for (const [x, y] of marks) g.fillRect(x, y, 1, 1);
}

function eyes(g, lx, rx, y, mode) {
  if (mode === 'hurt') {             // > <
    for (const [ex, dir] of [[lx, 1], [rx, -1]]) {
      px(g, ex, y - 1, 1, 1, OUT); px(g, ex + dir, y, 1, 1, OUT); px(g, ex, y + 1, 1, 1, OUT);
    }
    return;
  }
  if (mode === 'x') {
    for (const ex of [lx, rx]) { px(g, ex - 1, y - 1, 1, 1, OUT); px(g, ex + 1, y - 1, 1, 1, OUT); px(g, ex, y, 1, 1, OUT); px(g, ex - 1, y + 1, 1, 1, OUT); px(g, ex + 1, y + 1, 1, 1, OUT); }
    return;
  }
  for (const ex of [lx, rx]) { px(g, ex, y - 1, 2, 3, OUT); px(g, ex, y - 1, 1, 1, '#FFFFFF'); }
}

// 消散動畫（共用）：縮小 → 塵霧 → 星星 → 淡出
function deathFrame(g, w, h, i, body, dust) {
  const cx = w / 2, by = h - 2;
  if (i === 0) { body(g, { scale: 0.7, eyes: 'x' }); outline(g, w, h); return; }
  const puffs = [[cx - 6, by - 6, 4], [cx + 5, by - 5, 3], [cx, by - 11, 4], [cx - 2, by - 3, 3]];
  if (i === 1 || i === 2) {
    const s = i === 1 ? 1 : 0.7;
    for (const [x, y, r] of puffs) fillEllipse(g, x, y - (i - 1) * 3, r * s + 0.5, r * s + 0.5, dust);
    if (i === 1) outline(g, w, h, '#6B6B6B');
  }
  const star = (x, y, col) => { px(g, x, y - 1, 1, 3, col); px(g, x - 1, y, 3, 1, col); };
  if (i >= 2) {
    const k = i - 2, n = [5, 4, 2][k];
    const pts = [[cx - 9, by - 12], [cx + 8, by - 14], [cx - 2, by - 18], [cx + 4, by - 6], [cx - 7, by - 4]];
    for (let j = 0; j < n; j++) star(pts[j][0], pts[j][1] - k * 2, j % 2 ? '#F2C14E' : '#FFF8EC');
  }
}

// ---------------- 灰塵怪：灰色毛球 ----------------
function dustBody(w, h) {
  return (g, o = {}) => {
    const s = o.scale || 1;
    const rx = (o.rx || 11) * s, ry = (o.ry || 9) * s;
    const cx = w / 2 + (o.dx || 0), cy = h - 2 - ry + (o.dy || 0);
    const fuzz = (a) => (Math.floor((a + Math.PI) * 4) % 2 ? 0.9 : 0);
    fillEllipse(g, cx, cy, rx, ry, '#A9A9A9', fuzz);
    fillEllipse(g, cx + rx * 0.35, cy + ry * 0.35, rx * 0.55, ry * 0.5, '#8C8C8C');
    fillEllipse(g, cx - rx * 0.4, cy - ry * 0.45, rx * 0.3, ry * 0.25, '#C9C9C9');
    // 頭頂翹毛
    const ty = cy - ry - 1;
    px(g, cx - 1, ty - 1, 1, 2, '#A9A9A9'); px(g, cx, ty - 3, 1, 3, '#A9A9A9'); px(g, cx + 1, ty - 2, 1, 2, '#A9A9A9');
    eyes(g, Math.round(cx - 5), Math.round(cx + 2), Math.round(cy - 1), o.eyes);
    px(g, cx - 8, cy + 2, 2, 1, '#F6B0B0'); px(g, cx + 5, cy + 2, 2, 1, '#F6B0B0');
  };
}

// ---------------- 飢餓怪：大嘴紙袋 ----------------
function hungerBody(w, h) {
  return (g, o = {}) => {
    const s = o.scale || 1;
    const bw = Math.round(22 * s), bh = Math.round((o.bh || 22) * s);
    const x0 = Math.round(w / 2 - bw / 2 + (o.dx || 0)), y1 = h - 4 + (o.dy || 0), y0 = y1 - bh;
    px(g, x0, y0, bw, bh, '#D9B98A');
    px(g, x0, y0, 2, bh, '#BF9A68'); px(g, x0 + bw - 2, y0, 2, bh, '#BF9A68');
    for (let x = 0; x < bw; x += 3) px(g, x0 + x, y0 - 2, 2, 2, '#D9B98A');          // 撕開的袋口
    const legUp = o.leg || 0;                                                         // 兩隻小腳
    px(g, x0 + 5, y1, 3, 2 - (legUp === 1 ? 1 : 0), '#8B5A2B');
    px(g, x0 + bw - 8, y1, 3, 2 - (legUp === 2 ? 1 : 0), '#8B5A2B');
    if (s < 0.9) { eyes(g, x0 + 5, x0 + bw - 7, y0 + 5, o.eyes); return; }
    eyes(g, x0 + 5, x0 + bw - 7, y0 + 4, o.eyes);
    const mOpen = o.mouth ?? 1;                                                       // 0 閉、1 張、2 大張
    const mTop = y0 + 8, mH = [1, 7, 10][mOpen];
    px(g, x0 + 3, mTop, bw - 6, mH, '#4A2A18');
    if (mOpen) {
      for (let x = x0 + 4; x < x0 + bw - 4; x += 3) { px(g, x, mTop, 2, 2, '#FFF8EC'); px(g, x + 1, mTop + mH - 2, 2, 2, '#FFF8EC'); }
      px(g, x0 + 8, mTop + mH - 4, bw - 16, 2, '#E07A9A');                             // 舌頭
    }
  };
}

// ---------------- 搗蛋怪：粉紅毛線團 ----------------
function mischiefBody(w, h) {
  return (g, o = {}) => {
    const s = o.scale || 1;
    const r = 10 * s, rx = r * (o.sx || 1), ry = r * (o.sy || 1);
    const cx = w / 2 - 1 + (o.dx || 0), cy = h - 2 - ry + (o.dy || 0);
    // 線頭尾巴
    if (s > 0.9) {
      const tail = [[cx + rx - 1, cy + ry - 3], [cx + rx, cy + ry - 2], [cx + rx + 1, cy + ry - 2], [cx + rx + 2, cy + ry - 3], [cx + rx + 3, cy + ry - 4], [cx + rx + 3, cy + ry - 5]];
      for (const [x, y] of tail) px(g, x, y, 1, 1, '#E07A9A');
    }
    fillEllipse(g, cx, cy, rx, ry, '#F6B0B0');
    // 纏繞的毛線紋路（依 roll 旋轉）
    const roll = o.roll || 0;
    g.fillStyle = '#E07A9A';
    for (let k = 0; k < 3; k++) {
      for (let t = -1.1; t <= 1.1; t += 0.08) {
        const a = t + roll + k * 2.1;
        const x = cx + Math.cos(a) * rx * 0.75, y = cy + Math.sin(a) * ry * 0.75 * Math.cos(k);
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    fillEllipse(g, cx - rx * 0.4, cy - ry * 0.45, rx * 0.25, ry * 0.2, '#FCD3D3');
    if (o.eyes === 'hurt' || o.eyes === 'x') { eyes(g, Math.round(cx - 6), Math.round(cx + 1), Math.round(cy - 1), o.eyes); return; }
    px(g, cx - 6, cy - 2, 2, 3, OUT); px(g, cx - 6, cy - 2, 1, 1, '#FFFFFF');      // 左眼
    px(g, cx + 1, cy, 3, 1, OUT);                                                    // 右眼眨眼
    px(g, cx - 4, cy + 3, 4, 1, OUT); px(g, cx - 5, cy + 2, 1, 1, OUT);              // 壞笑
  };
}

const BODIES = { dust: dustBody, hunger: hungerBody, mischief: mischiefBody };

// 每個動作每一格的參數
const FRAMES = {
  dust: {
    move: [{ dy: 0 }, { dy: -2, ry: 9.5, rx: 10.5 }, { dy: -3 }, { dy: 0, ry: 8, rx: 12 }],
    attack: [{ dx: 2, rx: 10, ry: 10 }, { dx: -3, rx: 13, ry: 8 }, { dx: 0 }],
    hit: [{ rx: 13, ry: 7, eyes: 'hurt' }, { rx: 12, ry: 8, eyes: 'hurt' }],
  },
  hunger: {
    move: [{ leg: 1 }, { dy: -1, leg: 0 }, { leg: 2 }, { dy: -1, leg: 0 }],
    attack: [{ mouth: 2, dy: -1 }, { mouth: 0, dx: -3 }, { mouth: 1 }],
    hit: [{ bh: 19, eyes: 'hurt', mouth: 0 }, { bh: 20, eyes: 'hurt', mouth: 0 }],
  },
  mischief: {
    move: [{ roll: 0 }, { roll: 0.4, dy: -1 }, { roll: 0.8, dy: -2 }, { roll: 1.2, dy: -1 }],
    attack: [{ sx: 0.9, sy: 1.1, dx: 2 }, { sx: 1.2, sy: 0.85, dx: -3 }, { roll: 0.4 }],
    hit: [{ sx: 1.25, sy: 0.75, eyes: 'hurt' }, { sx: 1.1, sy: 0.9, eyes: 'hurt' }],
  },
};
const DUST_COLOR = { dust: '#BDBDBD', hunger: '#D9B98A', mischief: '#F6B0B0' };

export function buildMonsterSheets(assets) {
  for (const code of Object.keys(BODIES)) {
    const { w, h } = MONSTER_CELL[code];
    const body = BODIES[code](w, h);
    for (const [anim, spec] of Object.entries(MONSTER_ANIMS)) {
      const key = `monster_${code}_${anim}`;
      if (assets.has(key)) continue;                       // 你上傳的圖優先
      const [sheet, sg] = cell(w * spec.frames, h);
      for (let i = 0; i < spec.frames; i++) {
        const [c, g] = cell(w, h);
        if (anim === 'dead') deathFrame(g, w, h, i, body, DUST_COLOR[code]);
        else { body(g, FRAMES[code][anim][i]); outline(g, w, h); }
        sg.drawImage(c, i * w, 0);
      }
      assets.set(key, sheet);
    }
  }
}
