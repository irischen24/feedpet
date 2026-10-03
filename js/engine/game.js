// =====================================================================
// Game — requestAnimationFrame + 固定步長（1/60 秒）
//   Input → Update（Scene：AI / Collision）→ Render 分離
//   網路請求與日誌都不在 Game Loop 內同步執行
// =====================================================================
import { W, H } from './scaler.js';

const STEP = 1 / 60;

export class Game {
  constructor({ scaler, input, debug = false }) {
    this.scaler = scaler;
    this.ctx = scaler.ctx;
    this.input = input;
    this.debug = debug;
    this.scene = null;
    this.paused = false;
    this.running = false;
    this._acc = 0; this._last = 0;
    this._fps = 60; this._fpsAcc = 0; this._fpsFrames = 0;
    this._frame = this._frame.bind(this);
    this.debugInfo = () => ({});
    this.onFrame = null;
    this.timeScale = 1;             // 只供測試（?debug=1）使用            // 每幀呼叫（HUD 倒數等 UI 更新）
    document.addEventListener('visibilitychange', () => { this._last = performance.now(); });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  setScene(scene) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = scene;
    this.input.reset();
    if (scene && scene.enter) scene.enter();
  }

  _frame(now) {
    if (!this.running) return;
    const dt = Math.min((now - this._last) / 1000, 0.25);   // 分頁切回來時避免一次跳太多
    this._last = now;

    this._fpsAcc += dt; this._fpsFrames += 1;
    if (this._fpsAcc >= 0.5) { this._fps = this._fpsFrames / this._fpsAcc; this._fpsAcc = 0; this._fpsFrames = 0; }

    if (this.scene) {
      if (this.input.consume('pause') && this.scene.onPause) this.scene.onPause();
      if (!this.paused) {
        this._acc += dt * this.timeScale;
        while (this._acc >= STEP) { this.scene.update(STEP); this._acc -= STEP; }
      }
      this.render();
    }
    if (this.onFrame) this.onFrame(dt);
    this.input.endFrame();
    requestAnimationFrame(this._frame);
  }

  render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#3B2A20';
    ctx.fillRect(0, 0, W, H);
    this.scene.render(ctx);
    if (this.debug) this._renderDebug(ctx);
  }

  _renderDebug(ctx) {
    if (this.scene.renderDebug) this.scene.renderDebug(ctx);
    const info = { FPS: this._fps.toFixed(0), ...this.debugInfo() };
    const lines = Object.entries(info).map(([k, v]) => `${k}: ${v}`);
    ctx.save();
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(8, H - lines.length * 20 - 16, w, lines.length * 20 + 8);
    ctx.fillStyle = '#9be0a8';
    lines.forEach((l, i) => ctx.fillText(l, 16, H - lines.length * 20 - 12 + i * 20));
    ctx.restore();
  }
}
