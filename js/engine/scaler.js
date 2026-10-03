// =====================================================================
// Scaler — 遊戲世界固定 1280×720 邏輯座標；瀏覽器只負責縮放。
// 速度、碰撞、攻擊距離全部用邏輯座標，不同裝置公平一致。
// =====================================================================
import { CONFIG } from '../config.js';

export const W = CONFIG.GAME_WIDTH;
export const H = CONFIG.GAME_HEIGHT;

export class Scaler {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cssW = W; this.cssH = H; this.pixelRatio = 1;
    this.listeners = new Set();
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(stage);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 200));
    this.resize();
  }

  onResize(fn) { this.listeners.add(fn); }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const s = Math.min(r.width / W, r.height / H);
    this.cssW = Math.floor(W * s);
    this.cssH = Math.floor(H * s);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.pixelRatio = this.canvas.width / W;          // 邏輯 → 實體像素
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    // 讓 DOM 覆蓋層（HUD、控制鈕）對齊 Canvas
    const cr = this.canvas.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--canvas-left', `${cr.left}px`);
    root.setProperty('--canvas-top', `${cr.top}px`);
    root.setProperty('--canvas-w', `${cr.width}px`);
    root.setProperty('--canvas-h', `${cr.height}px`);
    for (const fn of this.listeners) fn(this);
  }

  // 螢幕座標 → 邏輯座標
  toLogical(clientX, clientY) {
    const cr = this.canvas.getBoundingClientRect();
    return { x: ((clientX - cr.left) / cr.width) * W, y: ((clientY - cr.top) / cr.height) * H };
  }
}
