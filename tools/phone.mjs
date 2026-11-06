// An emulated phone vs bots, driven only by touch: the stick walks, a right-side drag turns the
// camera, FIRE paints (and aims while dragged), SWIM toggles. Run twice: with the browser in
// landscape, and with the browser stuck upright (rotation lock, in-app browsers), where the game
// turns itself 90° and the phone is held sideways. Screenshots go to shots/.
//   node tools/phone.mjs [url]
import { mkdirSync } from "node:fs";
import { centre, launchBrowser, me, phone, PHONE } from "./phone-lib.mjs";

const URL = process.argv[2] ?? process.env.INK_URL ?? "http://127.0.0.1:5420/";
mkdirSync("shots", { recursive: true });
const results = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, info);
};

const browser = await launchBrowser();

async function run(upright) {
  const tag = upright ? "upright" : "landscape";
  console.log(`--- browser ${tag}`);
  const x = await phone(browser, URL, { scale: 2, upright });
  const { page, touch } = x;
  // Game (stage) coordinates -> screen: the stage is PHONE.width x PHONE.height either way.
  const S = upright ? (gx, gy) => [PHONE.height - gy, gx] : (gx, gy) => [gx, gy];
  const start = (id, gx, gy) => touch.start(id, ...S(gx, gy));
  const move = (id, gx, gy) => touch.move(id, ...S(gx, gy));
  const tapEl = async (sel) => touch.tap(...(await centre(page, sel)));

  check(`${tag}: detected as a touch device`, await page.evaluate(() => window.__ink.touchMode === true));
  const st = await page.evaluate(() => [document.body.classList.contains("rot"), getComputedStyle(document.getElementById("stage")).width, getComputedStyle(document.getElementById("stage")).height]);
  check(`${tag}: stage is landscape ${PHONE.width}x${PHONE.height}${upright ? ", turned" : ""}`, st[0] === upright && st[1] === `${PHONE.width}px` && st[2] === `${PHONE.height}px`, st.join(" "));
  await page.screenshot({ path: `shots/phone-${tag}-0-title.png` });
  await touch.tap(...S(PHONE.width / 2, PHONE.height / 2));
  await page.waitForSelector("#online");
  await page.screenshot({ path: `shots/phone-${tag}-1-menu.png` });
  await tapEl("#vbots");
  await page.waitForSelector("#start");
  await tapEl("#start");
  await page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 20000 });
  check(`${tag}: 2 v 2, two a side`, await page.evaluate(() => {
    const ps = [...window.__ink.world.players.values()];
    return ps.length === 4 && ps.filter((p) => p.team === 0).length === 2;
  }));

  // Walk: thumb down on the left of the game, push "up" (forward on the game's screen).
  const a = await me(page);
  await start(1, 140, 300);
  await move(1, 140, 230);
  await page.waitForTimeout(1500);
  const b = await me(page);
  await touch.end(1);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const walked = Math.hypot(dx, dz);
  // Forward is where the camera looks: (sin yaw, cos yaw).
  const fwd = (dx * Math.sin(a.cam[0]) + dz * Math.cos(a.cam[0])) / (walked || 1);
  check(`${tag}: stick up walks forward`, walked > 2 && fwd > 0.8, `moved ${walked.toFixed(2)} m, forward ${fwd.toFixed(2)}`);

  // Look: drag right on the right side turns the camera right (yaw goes down).
  await start(2, 560, 200);
  await move(2, 660, 200);
  await touch.end(2);
  const c = await me(page);
  check(`${tag}: drag right turns right`, c.cam[0] < b.cam[0] - 0.3, `yaw ${b.cam[0].toFixed(2)} -> ${c.cam[0].toFixed(2)}`);

  // Fire while walking (two thumbs), and aim by dragging the fire thumb left.
  const fire = await centre(page, "#touch .b-fire");
  const inkBefore = (await me(page)).ink;
  const turfBefore = await page.evaluate(() => window.__ink.world.players.get(window.__ink.myId).turf);
  await start(1, 140, 300);
  await move(1, 140, 240);
  await touch.start(3, ...fire);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/phone-${tag}-2-firing.png` });
  const yawBeforeAim = (await me(page)).cam[0];
  // 80 px left in game coordinates.
  const fireG = upright ? [fire[1], PHONE.height - fire[0]] : fire;
  await move(3, fireG[0] - 80, fireG[1]);
  await page.waitForTimeout(1200);
  const d = await me(page);
  const turfAfter = await page.evaluate(() => window.__ink.world.players.get(window.__ink.myId).turf);
  await touch.end(3);
  await touch.end(1);
  check(`${tag}: FIRE shoots ink`, d.ink < inkBefore - 5, `ink ${inkBefore.toFixed(0)} -> ${d.ink.toFixed(0)}`);
  check(`${tag}: FIRE paints turf`, turfAfter > turfBefore, `turf ${turfBefore.toFixed(0)} -> ${turfAfter.toFixed(0)}`);
  check(`${tag}: dragging the FIRE thumb left aims left`, d.cam[0] > yawBeforeAim + 0.2, `yaw ${yawBeforeAim.toFixed(2)} -> ${d.cam[0].toFixed(2)}`);

  // Swim: a tap toggles it on, another tap off.
  await tapEl("#touch .b-swim");
  await page.waitForTimeout(300);
  const s1 = await me(page);
  await tapEl("#touch .b-swim");
  await page.waitForTimeout(300);
  const s2 = await me(page);
  check(`${tag}: SWIM toggles`, s1.swim === true && s2.swim === false, `on=${s1.swim} off=${s2.swim}`);

  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/phone-${tag}-3-match.png` });

  await page.evaluate(() => (window.__ink.world.clock = 1.5));
  await page.waitForSelector(".verdict", { timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `shots/phone-${tag}-4-results.png` });
  check(`${tag}: results screen`, true, await page.textContent(".verdict"));
  await tapEl("#again");
  await page.waitForFunction(() => window.__ink.world?.state === "countdown" || window.__ink.world?.state === "play", null, { timeout: 10000 });
  check(`${tag}: "play again" starts a new match`, true);
  check(`${tag}: no page errors`, x.errors.length === 0, x.errors.join(" | "));
  await x.context.close();
}

await run(false);
await run(true);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
