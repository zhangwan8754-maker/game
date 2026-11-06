// Offline match against bots: start, play scripted for N seconds, screenshots, stats.
//   node tools/bots.mjs [seconds] [outdir]
import { launch } from "./gpu.mjs";
const SECS = +(process.argv[2] ?? 20);
const OUT = process.argv[3] ?? "shots";
const { browser, page, errors } = await launch();
await page.screenshot({ path: `${OUT}/0-title.png` });
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/1-menu.png` });
await page.evaluate(() => window.__ink.start());
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/2-setup.png` });
await page.click("#start");
await page.waitForTimeout(3600);
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < SECS * 1000) {
  await page.evaluate((i) => {
    const k = window.__ink.keys; k.clear();
    k.add(["KeyW", "KeyW", "KeyA", "KeyD"][i % 4]);
    window.__ink.mouse.fire = i % 5 !== 4;
    if (i % 7 === 3) k.add("ShiftLeft");
    window.__ink.setCam(Math.sin(i * 0.3) * 0.8, -0.25);
  }, i++);
  await page.waitForTimeout(400);
  if (i === 12) await page.screenshot({ path: `${OUT}/3-match.png` });
}
await page.screenshot({ path: `${OUT}/4-late.png` });
const s = await page.evaluate(() => { const w = window.__ink.world; return { state: w.state, clock: w.clock, cov: w.paint.coverage(), players: [...w.players.values()].map((p) => [p.name, p.team, p.weapon, Math.round(p.turf), p.kills, p.deaths, p.dead]) }; });
console.log(JSON.stringify(s), errors);
await browser.close();
