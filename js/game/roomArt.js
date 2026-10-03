// =====================================================================
// RoomArt — 沒有提供圖片的場景與物件，依原始房間圖延伸：
//   * 相同像素密度：在 1/3 解析度（427×240）作畫，再以 ×3 nearest 放大
//   * 相同色盤：奶油牆、暖木色、深咖啡描邊、天空藍
//   * 相同透視：正面牆 + 往前延伸的地面
// =====================================================================
export const PX = 3;            // 1 個美術像素 = 3 個邏輯像素
export const ART_W = 427, ART_H = 240;

export const P = {
  line: '#6B3E26', lineDark: '#4A2A18', wall: '#FBE6B6', wallShade: '#F3D49C',
  woodLight: '#F0B46A', wood: '#D9894A', woodDark: '#B86A35',
  sky: '#8DCFFF', skyLight: '#CFEFFF', cloud: '#F4FBFF',
  grass: '#A9D47A', grassDark: '#8CBF5E', grassLight: '#C4E39A',
  dirt: '#E8C58A', dirtDark: '#D4A86A',
  roof: '#C0603A', roofDark: '#9A4428', cream: '#FFF8EC', gold: '#F2C14E',
  pink: '#F6B0B0', kibble: '#8B5A2B', kibbleLight: '#B07440', fish: '#8DCFFF',
  floorStore: '#DDA563', floorStoreDark: '#C38A4C', sack: '#EADBB8', sackDark: '#CDB78E',
};

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  return [c, g];
}
const rect = (g, x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
function outlineBox(g, x, y, w, h, fill, line = P.line) {
  rect(g, x, y, w, h, line); rect(g, x + 1, y + 1, w - 2, h - 2, fill);
}
function rng(seed) {                         // 固定種子 → 每次畫出相同圖
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function fillEllipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    g.fillRect(cx - half, cy + y, half * 2, 1);
  }
}

// ---------- 物件 ----------
export function drawDoor(h = 70) {            // 42 × h
  const [c, g] = canvas(42, h);
  const top = Math.round((h - 12) * 0.45);
  outlineBox(g, 0, 0, 42, h, P.woodDark);
  outlineBox(g, 4, 4, 34, h - 4, P.wood);
  outlineBox(g, 8, 8, 26, top, P.woodLight);
  outlineBox(g, 8, 12 + top, 26, h - 18 - top, P.woodLight);
  rect(g, 9, 9, 24, 2, P.cream);                       // 上緣亮線，和原圖窗框一致
  const py = 8 + Math.round(top / 2) - 3;              // 粉紅貓掌貼紙
  rect(g, 18, py + 3, 6, 5, P.pink); rect(g, 16, py, 2, 2, P.pink); rect(g, 20, py - 1, 2, 2, P.pink); rect(g, 24, py, 2, 2, P.pink);
  const ky = 10 + top;
  rect(g, 30, ky, 3, 4, P.lineDark); rect(g, 31, ky + 1, 1, 2, P.gold);  // 門把
  return c;
}

export function drawFoodBox(state = 0) {      // 32 × 26：飼料箱；state 0 完整 / 1 低於 50% / 2 低於 20%
  const [c, g] = canvas(32, 26);
  const kib = [[4,3],[7,1],[10,2],[13,0],[16,1],[19,2],[22,1],[25,3],[6,4],[12,3],[18,3],[24,4],[9,4],[15,4],[21,4]];
  const keep = [kib.length, 8, 3][state];
  kib.slice(0, keep).forEach(([x, y], i) => { rect(g, x, y + state, 3, 3, P.line); rect(g, x + 1, y + 1 + state, 2, 2, i % 2 ? P.kibbleLight : P.kibble); });
  outlineBox(g, 0, 6, 32, 20, P.wood);
  rect(g, 1, 7, 30, 2, P.woodLight);
  rect(g, 1, 13, 30, 1, P.woodDark); rect(g, 1, 19, 30, 1, P.woodDark);
  rect(g, 3, 7, 2, 18, P.woodDark); rect(g, 27, 7, 2, 18, P.woodDark);
  rect(g, 10, 11, 10, 6, P.line); rect(g, 11, 12, 8, 4, P.fish); rect(g, 12, 12, 2, 1, P.cream);
  rect(g, 20, 12, 1, 4, P.line); rect(g, 21, 11, 2, 2, P.line); rect(g, 21, 15, 2, 2, P.line);
  rect(g, 13, 13, 1, 1, P.lineDark);
  if (state >= 1) {                             // 裂痕
    for (const [x, y] of [[6,8],[7,9],[7,10],[8,11],[8,12],[9,13]]) rect(g, x, y, 1, 1, P.lineDark);
  }
  if (state >= 2) {
    for (const [x, y] of [[24,9],[23,10],[24,11],[25,12],[24,13],[23,14],[23,15],[22,16]]) rect(g, x, y, 1, 1, P.lineDark);
    rect(g, 1, 20, 9, 5, P.woodDark); rect(g, 0, 25, 11, 1, P.line);    // 掉落的木板
  }
  return c;
}

export function drawFoodBoxSheet() {           // 96 × 26，3 格
  const [c, g] = canvas(96, 26);
  for (let i = 0; i < 3; i++) g.drawImage(drawFoodBox(i), i * 32, 0);
  return c;
}

export function drawCrate() {                 // 30 × 26：倉庫木箱
  const [c, g] = canvas(30, 26);
  outlineBox(g, 0, 0, 30, 26, P.woodLight);
  outlineBox(g, 3, 3, 24, 20, P.wood);
  g.fillStyle = P.woodDark;
  for (let i = 0; i < 20; i++) { g.fillRect(4 + Math.round(i * 22 / 20), 4 + i, 2, 1); g.fillRect(25 - Math.round(i * 22 / 20), 4 + i, 2, 1); }
  rect(g, 1, 1, 28, 1, P.cream);
  return c;
}

function drawWindow(g, x, y, w, h) {
  outlineBox(g, x, y, w, h, P.wood);
  rect(g, x + 3, y + 3, w - 6, h - 6, P.sky);
  rect(g, x + 3, y + h - 7, w - 6, 4, P.skyLight);
  rect(g, x + 5, y + 6, 8, 3, P.cloud); rect(g, x + 7, y + 4, 4, 2, P.cloud);
  rect(g, x + Math.floor(w / 2) - 1, y + 3, 2, h - 6, P.wood);
  rect(g, x + 3, y + Math.floor(h / 2) - 1, w - 6, 2, P.wood);
  outlineBox(g, x - 2, y + h - 1, w + 4, 4, P.woodLight);
}

// ---------- 場景 ----------
// 收容所後院：建築外牆 + 草地 + 通往飼料箱的泥土小路
export function drawYard() {
  const [c, g] = canvas(ART_W, ART_H);
  const r = rng(20261004);
  // 屋頂瓦片
  rect(g, 0, 0, ART_W, 11, P.roof);
  for (let y = 0; y < 11; y += 4) for (let x = (y % 8 ? 4 : 0); x < ART_W; x += 8) rect(g, x, y + 3, 7, 1, P.roofDark);
  rect(g, 0, 11, ART_W, 1, P.line);
  // 外牆
  rect(g, 0, 12, ART_W, 47, P.wall);
  rect(g, 0, 12, ART_W, 3, P.wallShade);
  drawWindow(g, 44, 20, 50, 28);
  drawWindow(g, 333, 20, 50, 28);
  g.drawImage(drawDoor(46), 192, 13);          // 門底部貼齊踢腳板
  // 招牌：木板 + 貓掌
  outlineBox(g, 130, 22, 40, 16, P.woodLight);
  rect(g, 146, 28, 6, 5, P.pink); rect(g, 144, 25, 2, 2, P.pink); rect(g, 148, 24, 2, 2, P.pink); rect(g, 152, 25, 2, 2, P.pink);
  outlineBox(g, 257, 22, 40, 16, P.woodLight);
  rect(g, 265, 27, 9, 5, P.line); rect(g, 266, 28, 7, 3, P.fish); rect(g, 274, 28, 2, 3, P.line);
  // 踢腳板
  rect(g, 0, 59, ART_W, 5, P.woodDark); rect(g, 0, 59, ART_W, 1, P.wood); rect(g, 0, 64, ART_W, 1, P.line);
  // 草地
  rect(g, 0, 65, ART_W, ART_H - 65, P.grass);
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * ART_W), y = 66 + Math.floor(r() * (ART_H - 68));
    const col = r() < 0.7 ? P.grassDark : P.grassLight;
    rect(g, x, y, 1, 2, col); rect(g, x + 2, y, 1, 2, col); rect(g, x + 1, y + 1, 1, 1, col);
  }
  // 泥土小路與中央空地
  for (let y = 65; y < 130; y++) {
    const t = (y - 65) / 65, half = Math.round(16 + t * 30);
    rect(g, 213 - half, y, half * 2, 1, P.dirt);
  }
  fillEllipse(g, 213, 152, 74, 34, P.dirtDark);
  fillEllipse(g, 213, 152, 72, 32, P.dirt);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    rect(g, Math.round(213 + Math.cos(a) * 66 * d), Math.round(152 + Math.sin(a) * 28 * d), 1, 1, P.dirtDark);
  }
  // 小花
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * ART_W), y = 75 + Math.floor(r() * 160);
    if (Math.abs(x - 213) < 90 && Math.abs(y - 152) < 45) continue;
    const col = r() < 0.5 ? P.cream : P.pink;
    rect(g, x - 1, y, 3, 1, col); rect(g, x, y - 1, 1, 3, col); rect(g, x, y, 1, 1, P.gold);
  }
  // 兩側木柵欄
  for (const fx of [0, ART_W - 6]) {
    for (let y = 70; y < ART_H; y += 20) { outlineBox(g, fx, y, 6, 18, P.wood); rect(g, fx + 1, y + 1, 4, 1, P.woodLight); }
  }
  return c;
}

// 飼料倉庫：室內，牆上貨架與飼料袋，木地板
export function drawStorage() {
  const [c, g] = canvas(ART_W, ART_H);
  rect(g, 0, 0, ART_W, 8, P.woodDark); rect(g, 0, 8, ART_W, 1, P.line);
  rect(g, 0, 9, ART_W, 58, '#F1D7A6'); rect(g, 0, 9, ART_W, 3, P.wallShade);
  // 貨架與飼料袋
  for (const sx of [12, 291]) {
    outlineBox(g, sx, 20, 124, 4, P.wood);
    outlineBox(g, sx, 44, 124, 4, P.wood);
    for (let i = 0; i < 6; i++) {
      for (const sy of [8, 32]) {
        const bx = sx + 6 + i * 20, by = sy + 3;
        outlineBox(g, bx, by, 16, 13, i % 2 ? P.sack : P.cream);
        rect(g, bx + 1, by + 1, 14, 2, P.sackDark);
        rect(g, bx + 5, by + 6, 6, 3, i % 3 === 0 ? P.fish : P.pink);
      }
    }
    rect(g, sx + 2, 48, 3, 18, P.woodDark); rect(g, sx + 119, 48, 3, 18, P.woodDark);
  }
  g.drawImage(drawDoor(56), 192, 11);
  rect(g, 0, 67, ART_W, 5, P.woodDark); rect(g, 0, 67, ART_W, 1, P.wood); rect(g, 0, 72, ART_W, 1, P.line);
  // 地板（與家中木地板同樣的錯縫，顏色較深）
  rect(g, 0, 73, ART_W, ART_H - 73, P.floorStore);
  let row = 0;
  for (let y = 73; y < ART_H; y += 14, row++) {
    rect(g, 0, y, ART_W, 1, P.floorStoreDark);
    for (let x = (row % 2) * 40; x < ART_W; x += 80) rect(g, x, y, 1, 14, P.floorStoreDark);
  }
  return c;
}
