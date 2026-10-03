// =====================================================================
// InputManager — Keyboard + Pointer Events（Mouse / Touch / Pen 共用）
//   移動：WASD / 方向鍵 / 左下虛擬搖桿 / 點地板移動
//   Enter：互動（家）或外出籠（戰場）  Space：技能  ESC：暫停
// =====================================================================
const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Enter: 'interact', NumpadEnter: 'interact', Space: 'skill', Escape: 'pause',
};

export class InputManager {
  constructor({ joystickEl, buttonEls = [], canvas, scaler }) {
    this.held = new Set();          // 按住中的 action
    this.pressed = new Set();       // 這一幀剛按下（consume 後清除）
    this.joy = { active: false, id: null, x: 0, y: 0 };
    this.tapTarget = null;          // 點地板移動的邏輯座標
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.scaler = scaler;

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.reset());

    if (joystickEl) this._bindJoystick(joystickEl);
    for (const el of buttonEls) this._bindButton(el);
    if (canvas) this._bindCanvas(canvas);

    // 避免手機縮放、長按選單、iOS 手勢
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('pointerdown', (e) => {
      const dev = e.pointerType === 'touch' ? 'touch' : 'pointer';
      if (dev !== this.lastDevice) { this.lastDevice = dev; document.body.classList.toggle('touch', dev === 'touch'); }
    }, { capture: true });
  }

  _isTypingTarget(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  _onKey(e, down) {
    if (this._isTypingTarget(e)) return;
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (this.enabled || action === 'pause') e.preventDefault();   // 避免方向鍵 / 空白鍵捲動頁面
    this.lastDevice = 'keyboard';
    document.body.classList.remove('touch');
    if (down) {
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
      if (['up', 'down', 'left', 'right'].includes(action)) this.tapTarget = null;
    } else {
      this.held.delete(action);
    }
  }

  _bindJoystick(el) {
    const knob = el.querySelector('.knob');
    const update = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      this.joy.x = dx / max; this.joy.y = dy / max;
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);          // 手指滑出範圍也不中斷
      this.joy.active = true; this.joy.id = e.pointerId; this.tapTarget = null;
      update(e);
    });
    el.addEventListener('pointermove', (e) => { if (this.joy.active && e.pointerId === this.joy.id) update(e); });
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { active: false, id: null, x: 0, y: 0 };
      if (knob) knob.style.transform = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  _bindButton(el) {
    const action = el.dataset.action;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    });
    const up = () => { el.classList.remove('down'); this.held.delete(action); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _bindCanvas(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.tapTarget = this.scaler.toLogical(e.clientX, e.clientY);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 0～1 的移動向量（鍵盤會正規化，斜走不會變快）
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    if (this.joy.active) {
      const len = Math.hypot(this.joy.x, this.joy.y);
      if (len < 0.18) return { x: 0, y: 0 };                       // dead zone
      const k = Math.min(1, (len - 0.18) / 0.82) / len;
      return { x: this.joy.x * k, y: this.joy.y * k };
    }
    let x = 0, y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  consume(action) {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return this.enabled || action === 'pause';
  }

  endFrame() { this.pressed.clear(); }

  reset() {
    this.held.clear(); this.pressed.clear(); this.tapTarget = null;
    this.joy = { active: false, id: null, x: 0, y: 0 };
    document.querySelectorAll('#joystick .knob').forEach((k) => { k.style.transform = ''; });
  }
}
