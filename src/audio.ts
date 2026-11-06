/** Synthesized sound (no files): squelchy shots, splats, booms, the whistle. */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Needs a user gesture; call from a click / key handler. */
  start(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const n = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine", at = 0): void {
    const c = this.ctx;
    if (!c || !this.master || this.muted) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1, at = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise || this.muted) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** `near` 0..1 attenuates by distance. */
  shot(kind: "blaster" | "roller" | "longshot", near = 1): void {
    if (near < 0.05) return;
    if (kind === "blaster") {
      this.tone(720 + Math.random() * 120, 240, 0.09, 0.12 * near, "triangle");
      this.hiss(0.06, 0.08 * near, 2400, 2);
    } else if (kind === "roller") this.hiss(0.18, 0.18 * near, 900, 0.8);
    else {
      this.tone(1600, 300, 0.22, 0.14 * near, "sawtooth");
      this.hiss(0.2, 0.12 * near, 3200, 1.5);
    }
  }

  splat(near = 1): void {
    if (near < 0.05) return;
    this.hiss(0.08, 0.1 * near, 500 + Math.random() * 400, 1.2);
    this.tone(220, 90, 0.07, 0.07 * near);
  }

  hit(): void {
    this.tone(1200, 1500, 0.05, 0.12, "square");
  }

  hurt(): void {
    this.tone(300, 120, 0.18, 0.2, "sawtooth");
    this.hiss(0.15, 0.15, 700, 1);
  }

  splatted(): void {
    this.tone(500, 60, 0.6, 0.3, "sawtooth");
    this.hiss(0.5, 0.25, 400, 0.7);
  }

  boom(near = 1): void {
    if (near < 0.03) return;
    this.tone(160, 35, 0.5, 0.35 * near);
    this.hiss(0.45, 0.3 * near, 300, 0.6);
  }

  swim(): void {
    this.hiss(0.12, 0.08, 350, 1.5);
  }

  whistle(): void {
    this.tone(2100, 2250, 0.5, 0.18, "sine");
    this.tone(2100, 2250, 0.3, 0.14, "sine", 0.55);
  }

  tick(): void {
    this.tone(1000, 1000, 0.05, 0.1, "square");
  }

  ui(): void {
    this.tone(660, 990, 0.06, 0.08, "triangle");
  }
}
