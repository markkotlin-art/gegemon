'use strict';
/* ГЕГЕМОН — Звуковой движок (Web Audio API)
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 5. ЗВУКОВОЙ ДВИЖОК (ЧИСТЫЙ WEB AUDIO API)
// -----------------------------------------------------------------------
const sfx = {
  ctx: null,
  muted: false,
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch (_) {}
  },
  tone(f, dur, type = 'sine', vol = 0.06, endF = null, delay = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (endF) o.frequency.exponentialRampToValueAtTime(endF, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (_) {}
  },
  click()   { this.tone(600, 0.04, 'triangle', 0.04, 420); },
  march()   { this.tone(240, 0.08, 'triangle', 0.05, 360); },
  recruit() { this.tone(440, 0.07, 'sine', 0.05, 580); },
  build()   { this.tone(320, 0.08, 'square', 0.03, 460); this.tone(520, 0.09, 'triangle', 0.04, 650, 0.05); },
  war()     { this.tone(145, 0.32, 'sawtooth', 0.07, 108, 0); this.tone(195, 0.38, 'sawtooth', 0.06, 130, 0.14); },
  capture() { this.tone(523, 0.1, 'triangle', 0.06, null, 0); this.tone(659, 0.12, 'triangle', 0.06, null, 0.08); this.tone(784, 0.2, 'triangle', 0.07, null, 0.16); },
  peace()   { this.tone(440, 0.16, 'sine', 0.05, null, 0); this.tone(554, 0.22, 'sine', 0.05, null, 0.11); },
  battle()  { this.tone(105, 0.11, 'sawtooth', 0.045, 45); }
};
