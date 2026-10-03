// =====================================================================
// 內建家具、裝飾、商店圖示（尺寸依《美術素材規格》）
// 你上傳 assets/furniture/furn_*.png、assets/decor/decor_*.png、
// assets/icons/icon_*.png 後會優先使用。
// =====================================================================
import { P } from './roomArt.js';

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
const R = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
const box = (g, x, y, w, h, fill, line = P.line) => { R(g, x, y, w, h, line); R(g, x + 1, y + 1, w - 2, h - 2, fill); };
function ell(g, cx, cy, rx, ry, col) {
  g.fillStyle = col;
  for (let y = -ry; y <= ry; y++) { const h = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry))); g.fillRect(cx - h, cy + y, h * 2, 1); }
}

// 尺寸（格）— 與規格文件一致
export const FURNITURE_SIZE = {
  cat_tree: [36, 56], scratcher: [24, 16], cat_bed: [32, 20], tunnel: [40, 18], bowl: [14, 8],
  fountain: [16, 18], litter_box: [30, 18], toy_mouse: [10, 6], rug_round: [68, 22],
};
// 不擋路的家具（貓可以走過去）
export const WALKABLE_FURNITURE = new Set(['rug_round', 'toy_mouse']);

const DRAW = {
  cat_tree(g) {
    box(g, 15, 10, 6, 44, P.sack); for (let y = 12; y < 54; y += 3) R(g, 16, y, 4, 1, P.sackDark);       // 麻繩柱
    box(g, 2, 50, 32, 6, P.woodDark);                                                                       // 底座
    box(g, 0, 30, 20, 5, P.pink); box(g, 16, 18, 20, 5, P.pink); box(g, 4, 2, 24, 9, P.pink);              // 平台
    R(g, 5, 3, 22, 2, '#FCD3D3'); R(g, 1, 31, 18, 1, '#FCD3D3'); R(g, 17, 19, 18, 1, '#FCD3D3');
    R(g, 30, 23, 1, 6, P.line); ell(g, 30, 30, 2, 2, P.gold);                                               // 吊球
  },
  scratcher(g) { box(g, 0, 4, 24, 12, P.sack); for (let x = 2; x < 22; x += 2) R(g, x, 6, 1, 8, P.sackDark); R(g, 1, 5, 22, 1, P.cream); },
  cat_bed(g) {
    ell(g, 16, 12, 15, 7, P.line); ell(g, 16, 12, 14, 6, P.sky); ell(g, 16, 13, 10, 3, P.cream);
    R(g, 3, 17, 26, 2, '#5FAFE0');
  },
  tunnel(g) {
    box(g, 6, 2, 34, 16, '#9CCB6B'); for (let x = 10; x < 38; x += 5) R(g, x, 3, 1, 14, '#7FAF52');
    ell(g, 7, 10, 6, 8, P.line); ell(g, 7, 10, 5, 7, '#7FAF52'); ell(g, 7, 10, 3, 5, P.lineDark);
  },
  bowl(g) { box(g, 1, 3, 12, 5, P.pink); R(g, 2, 4, 10, 1, '#FCD3D3'); for (let x = 3; x < 11; x += 2) R(g, x, 2, 2, 2, P.kibble); },
  fountain(g) {
    box(g, 1, 10, 14, 8, P.cream); R(g, 2, 11, 12, 2, P.sky);
    box(g, 5, 2, 6, 9, P.cream); R(g, 7, 0, 2, 3, P.sky); R(g, 6, 1, 1, 1, P.sky); R(g, 9, 1, 1, 1, P.sky);
  },
  litter_box(g, dirty) {
    box(g, 0, 6, 30, 12, P.sky); R(g, 1, 7, 28, 1, P.skyLight);
    box(g, 3, 4, 24, 4, '#E8DCC0');
    if (dirty) { for (const [x, y] of [[7, 3], [13, 2], [20, 3]]) { R(g, x, y, 4, 3, P.line); R(g, x + 1, y + 1, 2, 1, P.kibble); } }
  },
  toy_mouse(g) { ell(g, 5, 3, 4, 2, P.line); ell(g, 5, 3, 3, 1, '#BDBDBD'); R(g, 2, 1, 2, 2, P.pink); R(g, 9, 3, 1, 1, P.line); R(g, 3, 3, 1, 1, P.line); },
  rug_round(g) {
    ell(g, 34, 11, 33, 10, P.line); ell(g, 34, 11, 32, 9, '#E8A665'); ell(g, 34, 11, 24, 6, P.cream); ell(g, 34, 11, 12, 3, '#E8A665');
  },
};

export function drawFurniture(code, frame = 0) {
  const [w, h] = FURNITURE_SIZE[code];
  const [c, g] = canvas(w, h);
  DRAW[code](g, frame === 1);
  return c;
}

// 貓砂盆有 2 格（乾淨 / 有髒污）
export function drawFurnitureSheet(code) {
  if (code !== 'litter_box') return drawFurniture(code);
  const [w, h] = FURNITURE_SIZE[code];
  const [c, g] = canvas(w * 2, h);
  g.drawImage(drawFurniture(code, 0), 0, 0); g.drawImage(drawFurniture(code, 1), w, 0);
  return c;
}

// ---- 裝飾覆蓋層（房間 427×240 座標） ----
export function drawDecor(code) {
  if (code === 'floor_dark_wood') {                     // 覆蓋 y 143～240，地板梯形外透明
    const [c, g] = canvas(427, 97);
    for (let y = 0; y < 97; y++) {
      const ay = y + 143;
      const left = ay < 172 ? Math.round(43 - (ay - 143) * 43 / 29) : 0;
      const right = ay < 172 ? Math.round(384 + (ay - 143) * 43 / 29) : 427;
      R(g, left, y, right - left, 1, y % 14 === 0 ? '#7A4A2A' : '#A8693D');
    }
    for (let y = 0, row = 0; y < 97; y += 14, row++) for (let x = (row % 2) * 40 + 20; x < 427; x += 80) R(g, x, y, 1, 14, '#7A4A2A');
    g.globalCompositeOperation = 'destination-in';     // 只保留梯形範圍
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(43, 0); g.lineTo(384, 0); g.lineTo(427, 29); g.lineTo(427, 97); g.lineTo(0, 97); g.lineTo(0, 29); g.closePath(); g.fill();
    return c;
  }
  if (code === 'wallpaper_stripe') {                    // 覆蓋後牆 y 17～131，窗戶與門挖空
    const [c, g] = canvas(427, 143);
    for (let x = 43; x < 384; x++) R(g, x, 17, 1, 114, Math.floor((x - 43) / 8) % 2 ? '#F7D7C4' : '#FBE6D6');
    g.clearRect(156, 29, 115, 89);                      // 窗戶
    g.clearRect(314, 71, 46, 72);                       // 門
    return c;
  }
  return null;
}

// ---- 商店圖示 24×24 ----
export function drawIcon(code) {
  const [c, g] = canvas(24, 24);
  const fish = () => { R(g, 3, 8, 16, 9, P.line); R(g, 4, 9, 14, 7, P.fish); R(g, 19, 7, 4, 5, P.line); R(g, 19, 13, 4, 5, P.line); R(g, 6, 11, 2, 2, P.line); R(g, 5, 10, 3, 1, P.cream); };
  switch (code) {
    case 'fish': fish(); break;
    case 'food_basic': box(g, 4, 6, 16, 16, P.sack); R(g, 5, 7, 14, 3, P.sackDark); R(g, 8, 13, 8, 5, P.fish); R(g, 9, 4, 6, 3, P.line); break;
    case 'food_can': box(g, 4, 6, 16, 15, '#BDBDBD'); R(g, 5, 7, 14, 2, '#E0E0E0'); R(g, 5, 11, 14, 6, P.pink); R(g, 9, 12, 6, 4, P.cream); break;
    case 'food_treat': box(g, 7, 2, 10, 20, '#F2C14E'); R(g, 8, 3, 8, 3, '#F7DA8A'); R(g, 9, 10, 6, 6, '#E0703F'); break;
    case 'med_spot': box(g, 9, 2, 6, 6, P.cream); box(g, 7, 7, 10, 15, P.sky); R(g, 8, 8, 8, 2, P.skyLight); R(g, 10, 13, 4, 1, P.line); R(g, 11, 12, 2, 3, P.line); break;
    case 'med_ear': box(g, 9, 2, 6, 6, P.cream); box(g, 7, 7, 10, 15, P.pink); R(g, 8, 8, 8, 2, '#FCD3D3'); R(g, 10, 13, 4, 1, P.line); R(g, 11, 12, 2, 3, P.line); break;
    case 'med_heartworm': box(g, 3, 6, 18, 12, P.cream); R(g, 7, 9, 4, 4, '#E07A9A'); R(g, 13, 9, 4, 4, '#E07A9A'); R(g, 6, 10, 12, 4, '#E07A9A'); R(g, 9, 14, 6, 2, '#E07A9A'); break;
    case 'card_keep_growth': box(g, 3, 2, 18, 20, P.gold); R(g, 4, 3, 16, 2, '#F7DA8A'); R(g, 11, 7, 2, 10, P.line); R(g, 7, 11, 10, 2, P.line); break;
    case 'carrier': box(g, 2, 7, 20, 15, P.woodLight); R(g, 5, 10, 14, 9, P.line); for (let x = 6; x < 19; x += 3) R(g, x, 10, 1, 9, P.cream); R(g, 8, 3, 8, 5, P.line); R(g, 9, 4, 6, 3, P.woodLight); break;
    default: {
      const src = FURNITURE_SIZE[code] ? drawFurniture(code) : null;
      if (src) {                                          // 家具圖示：等比縮進 24×24
        const s = Math.min(22 / src.width, 22 / src.height, 1);
        const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
        g.drawImage(src, Math.round((24 - w) / 2), Math.round((24 - h) / 2), w, h);
      } else if (code === 'floor_dark_wood') { box(g, 2, 2, 20, 20, '#A8693D'); R(g, 3, 8, 18, 1, '#7A4A2A'); R(g, 3, 15, 18, 1, '#7A4A2A'); R(g, 11, 3, 1, 5, '#7A4A2A'); }
      else if (code === 'wallpaper_stripe') { box(g, 2, 2, 20, 20, '#FBE6D6'); for (let x = 3; x < 21; x += 4) R(g, x, 3, 2, 18, '#F7D7C4'); }
      else fish();
    }
  }
  return c;
}
