// =====================================================================
// AudioManager — 目前沒有音效素材，全部以 Web Audio 即時合成 Placeholder
// （不下載任何外部音檔，沒有版權疑慮）。之後放入音檔時，只要在
// SFX_FILES / BGM_FILE 填路徑即可改用檔案播放。
// =====================================================================
const SETTINGS_KEY = 'feedpet.audio.v1';

// 合成音效定義：[頻率, 開始秒, 長度秒, 波形]
const SYNTH = {
  attack: [[660, 0, 0.06, 'square'], [990, 0.04, 0.05, 'square']],
  damage: [[220, 0, 0.12, 'sawtooth'], [160, 0.08, 0.14, 'sawtooth']],
  pickup: [[784, 0, 0.07, 'triangle'], [1046, 0.07, 0.1, 'triangle']],
  door: [[392, 0, 0.1, 'triangle'], [523, 0.1, 0.14, 'triangle']],
  victory: [[523, 0, 0.12, 'triangle'], [659, 0.12, 0.12, 'triangle'], [784, 0.24, 0.12, 'triangle'], [1046, 0.36, 0.3, 'triangle']],
  gameover: [[392, 0, 0.18, 'triangle'], [330, 0.18, 0.18, 'triangle'], [262, 0.36, 0.4, 'triangle']],
  click: [[880, 0, 0.03, 'square']],
};

// 原創的八音盒旋律（C 大調五聲音階），每格 0.25 秒，0 = 休止
const BGM_NOTES = [523, 0, 659, 784, 659, 0, 587, 523, 440, 0, 523, 587, 659, 0, 0, 0,
                   587, 0, 659, 784, 880, 0, 784, 659, 587, 0, 523, 440, 523, 0, 0, 0];

export class AudioManager {
  constructor() {
    const saved = this._load();
    this.musicOn = saved.musicOn ?? true;
    this.sfxOn = saved.sfxOn ?? true;
    this.ctx = null;
    this._bgmTimer = null;
    this._bgmStep = 0;
    this._bgmNextTime = 0;
    this._wantBgm = false;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') this.ctx.suspend(); else this.ctx.resume();
    });
  }

  // 瀏覽器規定：第一次使用者互動後才能播放聲音
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    if (this._wantBgm) this.playBgm();
  }

  _tone(freq, start, dur, type, vol = 0.15, dest = this.master) {
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  sfx(name) {
    if (!this.sfxOn || !this.ctx || !SYNTH[name]) return;
    for (const [f, s, d, w] of SYNTH[name]) this._tone(f, s, d, w, 0.12);
  }

  playBgm() {
    this._wantBgm = true;
    if (!this.musicOn || !this.ctx || this._bgmTimer) return;
    this._bgmNextTime = this.ctx.currentTime + 0.1;
    const schedule = () => {                     // 音訊排程（不是畫面渲染）
      while (this._bgmNextTime < this.ctx.currentTime + 0.3) {
        const f = BGM_NOTES[this._bgmStep % BGM_NOTES.length];
        if (f) {
          const offset = this._bgmNextTime - this.ctx.currentTime;
          this._tone(f, offset, 0.4, 'sine', 0.05);
          this._tone(f / 2, offset, 0.3, 'triangle', 0.025);
        }
        this._bgmStep += 1; this._bgmNextTime += 0.25;
      }
      this._bgmTimer = setTimeout(schedule, 100);
    };
    schedule();
  }

  stopBgm() { this._wantBgm = false; clearTimeout(this._bgmTimer); this._bgmTimer = null; }

  setMusic(on) {
    this.musicOn = on; this._save();
    if (on) { this._wantBgm = true; this.playBgm(); } else { clearTimeout(this._bgmTimer); this._bgmTimer = null; }
  }
  setSfx(on) { this.sfxOn = on; this._save(); }

  _load() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }
  _save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ musicOn: this.musicOn, sfxOn: this.sfxOn })); } catch { /* ignore */ }
  }
}
