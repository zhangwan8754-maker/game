// Emulated phones (landscape, touch screen) in headless Chromium, plus real multi-touch input
// through the DevTools protocol.
//   PW_CHROMIUM=/path/to/chrome   use a specific Chromium build
import { chromium } from "playwright";

export const PHONE = { width: 844, height: 390 };

export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROMIUM || undefined,
    // Real local addresses in ICE (no mDNS names), so browsers on one machine can link up.
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"],
  });
}

/** A phone page: the browser in landscape, or stuck upright (`upright`, e.g. rotation lock). */
export async function phone(browser, url, { scale = 1, upright = false, weapon = null } = {}) {
  const viewport = upright ? { width: PHONE.height, height: PHONE.width } : PHONE;
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: scale });
  if (weapon) await context.addInitScript((w) => localStorage.setItem("inkrush.weapon", w), weapon);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("pageerror", (e) => errors.push("page: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ink, null, { timeout: 30000 });
  const cdp = await context.newCDPSession(page);
  return { context, page, errors, touch: new Fingers(cdp) };
}

/** Fingers on the glass: every event lists all the fingers still down, as a real screen does. */
export class Fingers {
  constructor(cdp) {
    this.cdp = cdp;
    this.down = new Map();
  }
  points() {
    return [...this.down].map(([id, [x, y]]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 }));
  }
  async start(id, x, y) {
    this.down.set(id, [x, y]);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: this.points() });
  }
  async move(id, x, y, steps = 6) {
    const [x0, y0] = this.down.get(id);
    for (let k = 1; k <= steps; k++) {
      this.down.set(id, [x0 + ((x - x0) * k) / steps, y0 + ((y - y0) * k) / steps]);
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: this.points() });
    }
  }
  async end(id) {
    this.down.delete(id);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: this.points() });
  }
  async tap(x, y, id = 9) {
    await this.start(id, x, y);
    await this.end(id);
  }
}

/** Centre of an element on the page. */
export async function centre(page, sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw new Error(`no ${sel}`);
  return [b.x + b.width / 2, b.y + b.height / 2];
}

export async function tapOn(x, sel) {
  const [cx, cy] = await centre(x.page, sel);
  await x.touch.tap(cx, cy);
}

export const me = (page) =>
  page.evaluate(() => {
    const w = window.__ink.world;
    const p = w?.players.get(window.__ink.myId);
    return p && { x: p.pos.x, z: p.pos.z, ink: p.ink, swim: p.swim, firing: p.firing, dead: p.dead, cam: window.__ink.cam, state: w.state };
  });
