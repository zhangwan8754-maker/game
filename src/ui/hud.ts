/** The match HUD (DOM over the canvas). */
import type { Team } from "../config";
import type { Player, World } from "../game/world";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export class Hud {
  readonly root: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly heads: HTMLElement[] = [];
  private readonly headsL: HTMLElement;
  private readonly headsR: HTMLElement;
  private readonly inkFill: HTMLElement;
  private readonly inkBox: HTMLElement;
  private readonly spec: HTMLElement;
  private readonly specTxt: HTMLElement;
  private readonly turf: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly center: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly net: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barA: HTMLElement;
  private readonly barB: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D;
  private mapT = 0;
  private hitT = 0;
  private colors: [number, number] = [0, 0];

  constructor(
    parent: HTMLElement,
    private readonly touch = false,
  ) {
    this.root = document.createElement("div");
    this.root.id = "hud";
    this.root.innerHTML = `
      <div class="top"><div class="heads l"></div><div class="clock">3:00</div><div class="heads r"></div></div>
      <div class="bar"><div class="a"></div><div class="b"></div></div>
      <div class="cross"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="ink"><div class="fill"></div><span>墨水</span></div>
      <div class="spec"><div class="ring"></div><span>0%</span><em>Q</em></div>
      <div class="turf">0<small>p</small></div>
      <div class="feed"></div>
      <div class="center"></div>
      <div class="banner"></div>
      <canvas class="map" width="120" height="200"></canvas>
      <div class="net"></div>
      ${touch ? "" : `<div class="keys">WASD 移动 · 鼠标 瞄准 · 左键 开火 · 右键 / E 炸弹 · Shift 潜游 · 空格 跳 · Q 大招</div>`}`;
    parent.appendChild(this.root);
    const $ = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.clock = $(".clock");
    this.headsL = $(".heads.l");
    this.headsR = $(".heads.r");
    this.inkFill = $(".ink .fill");
    this.inkBox = $(".ink");
    this.spec = $(".spec");
    this.specTxt = $(".spec span");
    this.turf = $(".turf");
    this.feed = $(".feed");
    this.center = $(".center");
    this.cross = $(".cross");
    this.banner = $(".banner");
    this.net = $(".net");
    this.bar = $(".bar");
    this.barA = $(".bar .a");
    this.barB = $(".bar .b");
    this.map = this.root.querySelector(".map") as HTMLCanvasElement;
    this.mapCtx = this.map.getContext("2d")!;
  }

  show(on: boolean): void {
    this.root.classList.toggle("off", !on);
  }

  setColors(c: [number, number]): void {
    this.colors = c;
    this.root.style.setProperty("--a", hex(c[0]));
    this.root.style.setProperty("--b", hex(c[1]));
  }

  /** Team 0 on the left for everyone; our team's heads get a ring. */
  roster(world: World): void {
    this.headsL.innerHTML = "";
    this.headsR.innerHTML = "";
    this.heads.length = 0;
    const ps = [...world.players.values()].sort((a, b) => a.team - b.team || a.slot - b.slot);
    for (const p of ps) {
      const h = document.createElement("div");
      h.className = "head t" + p.team + (p.id === world.localId ? " me" : "");
      h.dataset.id = String(p.id);
      h.innerHTML = `<i class="w-${p.weapon}"></i>`;
      h.title = p.name;
      (p.team === 0 ? this.headsL : this.headsR).appendChild(h);
      this.heads.push(h);
    }
  }

  feedLine(html: string): void {
    const d = document.createElement("div");
    d.innerHTML = html;
    this.feed.prepend(d);
    setTimeout(() => d.classList.add("gone"), 4200);
    setTimeout(() => d.remove(), 4800);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
  }

  name(p: Player | undefined): string {
    if (!p) return "?";
    return `<b style="color:${hex(this.colors[p.team])}">${escapeHtml(p.name)}</b>`;
  }

  hitMarker(): void {
    this.hitT = 0.18;
  }

  bannerText(t: string, cls = ""): void {
    this.banner.textContent = t;
    this.banner.className = "banner show " + cls;
    void this.banner.offsetWidth;
  }

  hideBanner(): void {
    this.banner.className = "banner";
  }

  netLine(t: string): void {
    this.net.textContent = t;
  }

  update(dt: number, world: World, me: Player | undefined, showBar: boolean): void {
    const s = Math.max(0, Math.ceil(world.clock));
    this.clock.textContent = world.state === "countdown" ? "准备" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    this.clock.classList.toggle("hurry", world.state === "play" && s <= 30);
    for (const h of this.heads) {
      const p = world.players.get(+h.dataset.id!);
      h.classList.toggle("dead", !!p?.dead);
      h.classList.toggle("sp", !!p && p.special >= p.w.special);
    }
    const [a, b] = world.paint.coverage();
    this.bar.classList.toggle("off", !showBar);
    const tot = a + b || 1;
    this.barA.style.width = `${(a / tot) * 100}%`;
    this.barB.style.width = `${(b / tot) * 100}%`;
    this.hitT -= dt;
    this.cross.classList.toggle("hit", this.hitT > 0);
    if (me) {
      this.inkFill.style.height = `${me.ink}%`;
      this.inkBox.classList.toggle("low", me.ink < 20);
      const k = Math.min(1, me.special / me.w.special);
      this.spec.style.setProperty("--k", String(k));
      this.spec.classList.toggle("full", k >= 1);
      this.specTxt.textContent = k >= 1 ? "就绪" : `${Math.floor(k * 100)}%`;
      this.turf.innerHTML = `${Math.floor(me.turf)}<small>点</small>`;
      this.cross.classList.toggle("charge", me.charge > 0);
      this.cross.style.setProperty("--c", String(me.charge));
      if (me.dead) this.center.innerHTML = `<div class="dead">被击倒了</div><div>${Math.max(0, me.respawnT).toFixed(1)} 秒后复活</div>`;
      else if (me.ink < 12 && world.state === "play")
        this.center.innerHTML = `<div class="hint">墨水不够了 · ${this.touch ? "点<b>潜游</b>" : "按住 <b>Shift</b>"}在自己的墨里补墨</div>`;
      else this.center.innerHTML = "";
    }
    this.mapT -= dt;
    if (this.mapT <= 0) {
      this.mapT = 0.25;
      this.drawMap(world, me);
    }
  }

  private drawMap(world: World, me: Player | undefined): void {
    const g = this.mapCtx;
    const a = world.arena;
    const W = this.map.width;
    const H = this.map.height;
    const img = g.createImageData(W, H);
    const ca = [(this.colors[0] >> 16) & 255, (this.colors[0] >> 8) & 255, this.colors[0] & 255];
    const cb = [(this.colors[1] >> 16) & 255, (this.colors[1] >> 8) & 255, this.colors[1] & 255];
    // Our base at the bottom of the map.
    const flip = me?.team === 1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let i = Math.floor((x / W) * a.w);
        let j = Math.floor((1 - y / H) * a.d);
        if (flip) {
          i = a.w - 1 - i;
          j = a.d - 1 - j;
        }
        const idx = j * a.w + i;
        const o = world.paint.owner[idx];
        const h = a.grid[idx];
        const k = (y * W + x) * 4;
        const base = 205 + Math.min(40, h * 14);
        const c = o === 1 ? ca : o === 2 ? cb : [base, base, base - 8];
        img.data[k] = c[0];
        img.data[k + 1] = c[1];
        img.data[k + 2] = c[2];
        img.data[k + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    for (const p of world.players.values()) {
      if (p.dead || !me || p.team !== me.team) continue;
      let u = (p.pos.x + a.def.halfX) / (a.def.halfX * 2);
      let v = 1 - (p.pos.z + a.def.halfZ) / (a.def.halfZ * 2);
      if (flip) {
        u = 1 - u;
        v = 1 - v;
      }
      g.fillStyle = p.id === me.id ? "#fff" : "#1b1d2a";
      g.strokeStyle = "#1b1d2a";
      g.beginPath();
      g.arc(u * W, v * H, p.id === me.id ? 4.5 : 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function teamName(t: Team): string {
  return t === 0 ? "Alpha" : "Bravo";
}
