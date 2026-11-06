/**
 * On-screen controls for phones, held in landscape.
 *
 *   left part of the screen  a floating stick: touch anywhere there, drag to walk (analog)
 *   right part               drag to look / aim
 *   FIRE                     hold to fire; keep dragging the same thumb to aim while firing
 *   SWIM                     a toggle (a phone has no spare thumb to hold it); firing, a bomb
 *                            or the special brings you back up
 *   JUMP / BOMB / SPECIAL    hold
 *
 * Everything is pointer events with one handler per finger (pointerId), so any mix of thumbs
 * works: walk + aim + fire at once.
 */

export type TouchButton = "fire" | "swim" | "jump" | "bomb" | "special";

interface Finger {
  kind: "stick" | "look" | "button";
  button?: TouchButton;
  x: number;
  y: number;
}

/** Stick travel in CSS px for full speed, and the dead zone (fraction of full travel). */
const STICK_R = 52;
const DEAD = 0.12;

export class TouchControls {
  readonly root: HTMLElement;
  /** Stick, -1..1 on each axis; y is forward. */
  mx = 0;
  my = 0;
  /** Look drag since the last read (CSS px). */
  lookDx = 0;
  lookDy = 0;
  fire = false;
  jump = false;
  bomb = false;
  special = false;
  /** Swim is a toggle. */
  swim = false;
  /** Called on every touch (unlocks audio). */
  onTouch: (() => void) | null = null;

  private readonly fingers = new Map<number, Finger>();
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = {} as Record<TouchButton, HTMLElement>;
  private stickX = 0;
  private stickY = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.className = "off";
    this.root.innerHTML = `
      <div class="stick rest"><i></i></div>
      <div class="tb b-special" data-b="special"><span>大招</span></div>
      <div class="tb b-jump" data-b="jump"><span>跳</span></div>
      <div class="tb b-bomb" data-b="bomb"><span>炸弹</span></div>
      <div class="tb b-swim" data-b="swim"><span>潜游</span></div>
      <div class="tb b-fire" data-b="fire"><span>开火</span></div>`;
    parent.appendChild(this.root);
    this.stick = this.root.querySelector(".stick") as HTMLElement;
    this.knob = this.stick.querySelector("i") as HTMLElement;
    this.root.querySelectorAll<HTMLElement>("[data-b]").forEach((el) => (this.buttons[el.dataset.b as TouchButton] = el));

    const r = this.root;
    r.addEventListener("pointerdown", (e) => this.down(e));
    r.addEventListener("pointermove", (e) => this.move(e));
    r.addEventListener("pointerup", (e) => this.up(e));
    r.addEventListener("pointercancel", (e) => this.up(e));
    r.addEventListener("lostpointercapture", (e) => this.up(e));
    r.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.root.classList.contains("off");
  }

  show(on: boolean): void {
    this.root.classList.toggle("off", !on);
    if (!on) this.reset();
  }

  /** Let go of everything (a match ended, the tab lost focus). */
  reset(): void {
    this.fingers.clear();
    this.mx = this.my = this.lookDx = this.lookDy = 0;
    this.fire = this.jump = this.bomb = this.special = this.swim = false;
    this.stick.classList.add("rest");
    this.stick.style.left = this.stick.style.top = "";
    this.knob.style.transform = "";
    for (const b of Object.values(this.buttons)) b.classList.remove("on");
  }

  /** Read and clear the look drag. */
  takeLook(): [number, number] {
    const d: [number, number] = [this.lookDx, this.lookDy];
    this.lookDx = this.lookDy = 0;
    return d;
  }

  /** Per frame: the special button's gauge, and swim's state (the game may have ended it). */
  update(specialK: number, swimming: boolean): void {
    const sp = this.buttons.special;
    sp.style.setProperty("--k", String(Math.min(1, specialK)));
    sp.classList.toggle("ready", specialK >= 1);
    this.buttons.swim.classList.toggle("on", this.swim || swimming);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.onTouch?.();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer */
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-b]");
    if (el) {
      const b = el.dataset.b as TouchButton;
      el.classList.add("on");
      if (b === "swim") {
        this.swim = !this.swim;
        this.fingers.set(e.pointerId, { kind: "button", button: b, x: e.clientX, y: e.clientY });
        return;
      }
      if (b === "fire" || b === "bomb" || b === "special") this.swim = false;
      this[b] = true;
      // The fire button aims too: drag the same thumb.
      this.fingers.set(e.pointerId, { kind: b === "fire" ? "look" : "button", button: b, x: e.clientX, y: e.clientY });
      return;
    }
    if (e.clientX < window.innerWidth * 0.42) {
      // A new stick where the thumb landed (one stick at a time).
      for (const [id, f] of this.fingers) if (f.kind === "stick") this.fingers.delete(id);
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.classList.remove("rest");
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = "";
      this.mx = this.my = 0;
      this.fingers.set(e.pointerId, { kind: "stick", x: e.clientX, y: e.clientY });
      return;
    }
    this.fingers.set(e.pointerId, { kind: "look", x: e.clientX, y: e.clientY });
  }

  private move(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    e.preventDefault();
    if (f.kind === "stick") {
      let dx = e.clientX - this.stickX;
      let dy = e.clientY - this.stickY;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        // Past the rim: the stick follows the thumb, so the thumb never runs out of stick.
        const k = (d - STICK_R) / d;
        this.stickX += dx * k;
        this.stickY += dy * k;
        this.stick.style.left = `${this.stickX}px`;
        this.stick.style.top = `${this.stickY}px`;
        dx = e.clientX - this.stickX;
        dy = e.clientY - this.stickY;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.hypot(dx, dy) / STICK_R;
      if (m < DEAD) this.mx = this.my = 0;
      else {
        // Rescale past the dead zone so a small push still means a slow walk.
        const s = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
        this.mx = (dx / STICK_R) * s;
        this.my = (-dy / STICK_R) * s;
      }
    } else if (f.kind === "look") {
      this.lookDx += e.clientX - f.x;
      this.lookDy += e.clientY - f.y;
    }
    f.x = e.clientX;
    f.y = e.clientY;
  }

  private up(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.kind === "stick") {
      this.mx = this.my = 0;
      this.stick.classList.add("rest");
      this.stick.style.left = this.stick.style.top = "";
      this.knob.style.transform = "";
    }
    if (f.button) {
      this.buttons[f.button].classList.remove("on");
      if (f.button !== "swim") this[f.button] = false;
    }
  }
}

/** A phone or tablet: no fine pointer, a touch screen. `?touch=1` / `?touch=0` force it. */
export function isTouchDevice(): boolean {
  const q = new URLSearchParams(location.search).get("touch");
  if (q === "1") return true;
  if (q === "0") return false;
  return (navigator.maxTouchPoints > 0 || "ontouchstart" in window) && matchMedia("(pointer: coarse)").matches;
}

/** Full screen and landscape where the browser allows it (Android); iOS ignores both. */
export function goFullscreen(): void {
  const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  const p = d.requestFullscreen?.({ navigationUI: "hide" }) ?? (d.webkitRequestFullscreen?.(), undefined);
  const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => undefined);
  if (p) p.then(lock).catch(() => undefined);
  else lock();
}
