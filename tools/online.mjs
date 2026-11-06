// Two (or more) real browsers in one online match over the PeerJS broker: the host creates a
// room, the guests join by link, the host starts; everyone plays scripted input. Checks that
// all machines agree on the turf and the scores.
//   node tools/online.mjs [seconds] [guests]
import { launch } from "./gpu.mjs";
const SECS = +(process.argv[2] ?? 25);
const GUESTS = +(process.argv[3] ?? 1);
const BASE = process.env.INK_URL ?? "http://localhost:5421/";
const H = await launch({ url: BASE, width: 960, height: 540 });
await H.page.keyboard.press("Enter");
await H.page.click("#online");
await H.page.click("#create");
await H.page.waitForFunction(() => document.querySelector(".status")?.textContent.includes("房间已开好"), null, { timeout: 30000 });
const link = await H.page.evaluate(() => document.querySelector("#link").textContent);
console.log("room link", link);
const G = [];
for (let k = 0; k < GUESTS; k++) {
  const g = await launch({ url: link, width: 960, height: 540 });
  G.push(g);
}
await H.page.waitForFunction((n) => document.querySelectorAll(".slot:not(.bot)").length >= n + 1, GUESTS, { timeout: 40000 });
await H.page.screenshot({ path: "shots/online-lobby.png" });
await H.page.click("#start");
const all = [H, ...G];
await Promise.all(all.map((x) => x.page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 20000 })));
const drive = (x, seed) => x.page.evaluate((seed) => {
  let i = seed;
  setInterval(() => {
    const k = window.__ink.keys; k.clear();
    k.add(["KeyW", "KeyW", "KeyA", "KeyD", "KeyW"][i % 5]);
    window.__ink.mouse.fire = i % 6 !== 5;
    window.__ink.mouse.bomb = i % 23 === 7;
    if (i % 9 === 4) k.add("ShiftLeft");
    if (i % 31 === 11) k.add("KeyQ");
    window.__ink.setCam(Math.sin(i * 0.23) * 0.9 + (window.__ink.world.players.get(window.__ink.myId).team ? Math.PI : 0), -0.25);
    i++;
  }, 350);
}, seed);
await Promise.all(all.map((x, k) => drive(x, k * 13)));
const snap = (x) => x.page.evaluate(() => { const w = window.__ink.world; const c = w.paint.coverage(); return { st: w.state, clock: Math.round(w.clock), cov: c.map((v) => +(v * 100).toFixed(2)), owned: [w.paint.count[0], w.paint.count[1]], score: [...w.players.values()].map((p) => `${p.id}:${Math.round(p.turf)}/${p.kills}/${p.deaths}`).join(" ") }; });
for (let t = 0; t < SECS; t += 5) {
  await H.page.waitForTimeout(5000);
  const s = await Promise.all(all.map(snap));
  console.log(`${t + 5}s`, s.map((x) => JSON.stringify(x)).join("\n    "));
}
await Promise.all(all.map((x, k) => x.page.screenshot({ path: `shots/online-${k}.png` })));
console.log("errors", all.map((x) => x.errors));
for (const x of all) await x.browser.close();
