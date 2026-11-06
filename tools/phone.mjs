// One emulated phone vs bots, driven only by touch: the stick walks, a right-side drag turns the
// camera, FIRE paints (and aims while dragged), SWIM toggles. Screenshots go to shots/.
//   node tools/phone.mjs [url]
import { mkdirSync } from "node:fs";
import { launchBrowser, me, phone, PHONE, tapOn, centre } from "./phone-lib.mjs";

const URL = process.argv[2] ?? process.env.INK_URL ?? "http://127.0.0.1:5420/";
mkdirSync("shots", { recursive: true });
const browser = await launchBrowser();
const x = await phone(browser, URL, { scale: 2 });
const { page, touch } = x;
const results = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, info);
};

check("detected as a touch device", await page.evaluate(() => window.__ink.touchMode === true));
await page.screenshot({ path: "shots/phone-0-title.png" });
await touch.tap(PHONE.width / 2, PHONE.height / 2);
await page.waitForSelector("#online");
await page.screenshot({ path: "shots/phone-1-menu.png" });
await tapOn(x, "#vbots");
await page.waitForSelector("#start");
await tapOn(x, "#start");
await page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 20000 });
check("2 v 2: four players, two a side", await page.evaluate(() => {
  const ps = [...window.__ink.world.players.values()];
  return ps.length === 4 && ps.filter((p) => p.team === 0).length === 2;
}));
check("touch controls on screen", await page.isVisible("#touch .b-fire"));

// Walk: thumb down on the left, push up (forward) for 1.5 s.
const a = await me(page);
await touch.start(1, 140, 300);
await touch.move(1, 140, 230);
await page.waitForTimeout(1500);
const b = await me(page);
await touch.end(1);
const walked = Math.hypot(b.x - a.x, b.z - a.z);
check("stick walks the player", walked > 2, `moved ${walked.toFixed(2)} m`);

// Look: drag on the right side turns the camera.
await touch.start(2, 560, 200);
await touch.move(2, 660, 200);
await touch.end(2);
const c = await me(page);
check("right-side drag turns the camera", Math.abs(c.cam[0] - b.cam[0]) > 0.3, `yaw ${b.cam[0].toFixed(2)} -> ${c.cam[0].toFixed(2)}`);

// Fire while walking (two thumbs), and aim by dragging the fire thumb.
const [fx, fy] = await centre(page, "#touch .b-fire");
const inkBefore = (await me(page)).ink;
const turfBefore = await page.evaluate(() => window.__ink.world.players.get(window.__ink.myId).turf);
await touch.start(1, 140, 300);
await touch.move(1, 140, 240);
await touch.start(3, fx, fy);
await page.waitForTimeout(300);
await page.screenshot({ path: "shots/phone-2-firing.png" });
const yawBeforeAim = (await me(page)).cam[0];
await touch.move(3, fx - 80, fy);
await page.waitForTimeout(1200);
const d = await me(page);
const turfAfter = await page.evaluate(() => window.__ink.world.players.get(window.__ink.myId).turf);
await touch.end(3);
await touch.end(1);
check("FIRE shoots ink (ink tank drains)", d.ink < inkBefore - 5, `ink ${inkBefore.toFixed(0)} -> ${d.ink.toFixed(0)}`);
check("FIRE paints turf", turfAfter > turfBefore, `turf ${turfBefore.toFixed(0)} -> ${turfAfter.toFixed(0)}`);
check("dragging the FIRE thumb aims", Math.abs(d.cam[0] - yawBeforeAim) > 0.2, `yaw ${yawBeforeAim.toFixed(2)} -> ${d.cam[0].toFixed(2)}`);

// Swim: a tap toggles it on, another tap off.
await tapOn(x, "#touch .b-swim");
await page.waitForTimeout(300);
const s1 = await me(page);
await tapOn(x, "#touch .b-swim");
await page.waitForTimeout(300);
const s2 = await me(page);
check("SWIM toggles", s1.swim === true && s2.swim === false, `on=${s1.swim} off=${s2.swim}`);

await page.waitForTimeout(2000);
await page.screenshot({ path: "shots/phone-3-match.png" });

// The rest of the match on autopilot (the bots play on), then results.
await page.evaluate(() => (window.__ink.world.clock = 1.5));
await page.waitForSelector(".verdict", { timeout: 15000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: "shots/phone-4-results.png" });
check("results screen", true, await page.textContent(".verdict"));
check("no page errors", x.errors.length === 0, x.errors.join(" | "));

// Portrait: the rotate prompt covers the game.
await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
await page.waitForTimeout(300);
check("portrait shows the rotate prompt", await page.isVisible("#rotate"));
await page.screenshot({ path: "shots/phone-5-portrait.png" });

await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
