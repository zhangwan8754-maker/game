// The armoury, the bots' top skill and the terrace stage, checked in real browsers (offline
// matches vs bots, keyboard/mouse inputs set directly).
//   node tools/content.mjs [url]
import { mkdirSync } from "node:fs";
import { launchBrowser } from "./phone-lib.mjs";

const URL = process.argv[2] ?? process.env.INK_URL ?? "http://127.0.0.1:5420/";
mkdirSync("shots", { recursive: true });
const ok = [];
const check = (name, v, info = "") => {
  ok.push(v);
  console.log(v ? "PASS" : "FAIL", name, info);
};
const browser = await launchBrowser();

/** An offline match with this weapon, stage and bot skill; game events recorded in __ev. */
async function match(weapon, { map = 0, skill = "fresh" } = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((w) => localStorage.setItem("inkrush.weapon", w), weapon);
  await page.goto(URL + (URL.includes("?") ? "&" : "?") + "touch=0");
  await page.waitForFunction(() => window.__ink);
  await page.keyboard.press("Enter"); // title -> menu
  await page.waitForSelector("#vbots");
  await page.evaluate(() => window.__ink.start());
  await page.click(`[data-group=map] [data-v="${map}"]`);
  await page.click(`[data-group=skill] [data-v="${skill}"]`);
  await page.click("#start");
  await page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 30000 });
  await page.evaluate(() => {
    const w = window.__ink.world;
    window.__ev = [];
    const emit = w.emit.bind(w);
    w.emit = (e) => {
      window.__ev.push({ ...e, at: performance.now(), clock: w.clock });
      emit(e);
    };
  });
  return { page, errors };
}

const me = (page) =>
  page.evaluate(() => {
    const p = window.__ink.world.players.get(window.__ink.myId);
    // clock: game seconds left (the game can run slower than real time on a slow machine).
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, ink: p.ink, turf: p.turf, weapon: p.weapon, dead: p.dead, clock: window.__ink.world.clock };
  });

/** Hold fire (and optionally walk) for `ms`, aiming at the ground ahead. */
async function fire(page, ms, { walk = false, pitch = -0.35 } = {}) {
  await page.evaluate(
    ([walk, pitch]) => {
      window.__ink.setCam(0, pitch);
      window.__fireAt = window.__ink.world.clock;
      window.__ink.mouse.fire = true;
      if (walk) window.__ink.keys.add("KeyW");
    },
    [walk, pitch],
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    window.__ink.mouse.fire = false;
    window.__ink.keys.clear();
  });
  await page.waitForTimeout(600);
}

const mine = (page, k) => page.evaluate((k) => window.__ev.filter((e) => e.k === k && (e.id === window.__ink.myId || e.by === window.__ink.myId)), k);

// ---------------------------------------------------------------- weapons
for (const weapon of ["blaster", "scatter", "gatling", "cannon", "roller", "brush", "longshot"]) {
  const { page, errors } = await match(weapon);
  const a = await me(page);
  const roll = weapon === "roller" || weapon === "brush";
  await fire(page, 2000, { walk: roll });
  const b = await me(page);
  const shots = await mine(page, "shot");
  const info = `${weapon}: ink ${a.ink.toFixed(0)}->${b.ink.toFixed(0)}, turf ${a.turf.toFixed(0)}->${b.turf.toFixed(0)}, ${shots.length} shots`;
  check(`${weapon}: is the weapon in hand`, b.weapon === weapon);
  check(`${weapon}: fires and paints`, b.turf > a.turf + 3 && b.ink < a.ink, info);
  if (weapon === "scatter") {
    const perPull = Math.max(...Object.values(shots.reduce((m, e) => ((m[Math.round(e.at)] = (m[Math.round(e.at)] ?? 0) + 1), m), {})));
    check("scatter: six pellets per pull", perPull === 6, `${perPull} per pull`);
  }
  if (weapon === "gatling") {
    // Game time: the clock counts down.
    const fireAt = await page.evaluate(() => window.__fireAt);
    const first = shots.length ? fireAt - shots[0].clock : Infinity;
    check("gatling: spins up before the first shot", first > 0.5 && first < 0.65, `first shot ${first.toFixed(2)} s after the trigger`);
    const rate = (shots.length - 1) / (shots[0].clock - shots[shots.length - 1].clock);
    check("gatling: then fires 20 shots a second", rate > 18.5 && rate < 21.5, `${rate.toFixed(1)} shots/s`);
  }
  if (weapon === "cannon") {
    const booms = await page.evaluate(() => window.__ev.filter((e) => e.k === "boom" && e.t === window.__ink.world.players.get(window.__ink.myId).team).length);
    check("cannon: shots burst", booms >= shots.length && shots.length >= 2, `${shots.length} shots, ${booms} bursts`);
  }
  if (roll) {
    const stripes = await mine(page, "stripe");
    const width = stripes[0]?.w;
    // Speed over the rolling stretch only (the first 0.22 s of a hold is a walk), in game time.
    const s0 = stripes[0];
    const s1 = stripes[stripes.length - 1];
    const speed = s0 && s1 !== s0 ? Math.hypot(s1.bx - s0.bx, s1.bz - s0.bz) / (s0.clock - s1.clock) : 0;
    check(`${weapon}: rolls a ${weapon === "brush" ? "1" : "2"} m stripe`, width === (weapon === "brush" ? 1 : 2), `width ${width}, ${stripes.length} stripes`);
    if (weapon === "brush") check("brush: runs faster than walking while brushing", speed > 6.3, `${speed.toFixed(2)} m/s (walk is 5.6)`);
  }
  if (weapon === "longshot") check("longshot: still fires beams", (await mine(page, "beam")).length > 0);
  check(`${weapon}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- the terrace stage
{
  const { page, errors } = await match("blaster", { map: 1 });
  const name = await page.evaluate(() => window.__ink.world.arena.def.name);
  check("terrace: stage loads", name === "梯田遗迹", name);
  const climb = async (x, z, ms) => {
    await page.evaluate(
      ([x, z]) => {
        const w = window.__ink.world;
        const p = w.players.get(window.__ink.myId);
        p.pos.set(x, w.arena.height(x, z), z);
        p.vel.set(0, 0, 0);
        window.__ink.setCam(0, -0.1);
        window.__ink.keys.add("KeyW");
        window.__top = 0;
        window.__climb = setInterval(() => (window.__top = Math.max(window.__top, w.players.get(window.__ink.myId).pos.y)), 50);
      },
      [x, z],
    );
    await page.waitForTimeout(ms);
    return page.evaluate(() => {
      clearInterval(window.__climb);
      window.__ink.keys.clear();
      return window.__top;
    });
  };
  const terraceTop = await climb(-12, -23, 2600);
  check("terrace: walk up the terrace steps to the 2 m lookout", terraceTop >= 1.95, `highest ${terraceTop.toFixed(2)} m`);
  await page.screenshot({ path: "shots/terrace-lookout.png" });
  const ridgeTop = await climb(12.5, -23.5, 2400);
  check("terrace: walk up the ramp onto the 2.2 m ridge", ridgeTop >= 2.15, `highest ${ridgeTop.toFixed(2)} m`);
  const plateau = await climb(0, -10, 2000);
  check("terrace: walk up onto the central plateau", plateau >= 1.55, `highest ${plateau.toFixed(2)} m`);
  await page.screenshot({ path: "shots/terrace-plateau.png" });
  // A grate never takes ink.
  const grate = await page.evaluate(() => {
    const w = window.__ink.world;
    w.paint.splat(0, -12, 2, 0, 99);
    w.paint.flush();
    return w.paint.ownerAt(0, -12);
  });
  check("terrace: grates stay ink-free", grate === 0);
  // Bots get around: after 20 s they have painted all over.
  await page.waitForTimeout(20000);
  const cov = await page.evaluate(() => window.__ink.world.paint.coverage());
  check("terrace: bots paint the stage", cov[0] + cov[1] > 0.12, `coverage ${(cov[0] * 100).toFixed(1)}% / ${(cov[1] * 100).toFixed(1)}%`);
  check("terrace: no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- bot skill: chill vs legend
// Stand still in the open for 30 s against two enemy bots; count how often they splat us.
const deaths = {};
for (const skill of ["chill", "legend"]) {
  const { page, errors } = await match("blaster", { map: 0, skill });
  await page.evaluate(() => {
    const w = window.__ink.world;
    setInterval(() => {
      const p = w.players.get(window.__ink.myId);
      if (!p.dead && p.pos.z < -10) {
        p.pos.set(0, w.arena.height(0, -6), -6);
        p.vel.set(0, 0, 0);
      }
    }, 300);
  });
  await page.waitForTimeout(30000);
  deaths[skill] = await page.evaluate(() => window.__ink.world.players.get(window.__ink.myId).deaths);
  check(`${skill}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}
check("legend bots are deadlier than chill bots", deaths.legend > deaths.chill, `splatted ${deaths.chill}x by chill, ${deaths.legend}x by legend in 30 s`);

await browser.close();
process.exit(ok.every(Boolean) ? 0 : 1);
