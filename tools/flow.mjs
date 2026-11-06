// Online flow: results on both screens, back to the lobby, a second match, a guest leaving mid-match.
import { launch } from "./gpu.mjs";
const BASE = process.env.INK_URL ?? "http://localhost:5421/";
const H = await launch({ url: BASE, width: 960, height: 540 });
await H.page.keyboard.press("Enter");
await H.page.click("#online");
await H.page.click("#create");
await H.page.waitForFunction(() => document.querySelector(".status")?.textContent.includes("room open"), null, { timeout: 30000 });
const link = await H.page.evaluate(() => document.querySelector("#link").textContent);
const G = await launch({ url: link, width: 960, height: 540 });
await H.page.waitForFunction(() => document.querySelectorAll(".slot:not(.bot)").length >= 2, null, { timeout: 40000 });
const ok = [];
const check = (name, v) => { ok.push([name, v]); console.log(v ? "PASS" : "FAIL", name); };
for (let round = 1; round <= 2; round++) {
  await H.page.click("#start");
  await Promise.all([H, G].map((x) => x.page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 20000 })));
  check(`round ${round}: both playing`, true);
  await H.page.evaluate(() => { window.__ink.world.clock = 2; });
  await Promise.all([H, G].map((x) => x.page.waitForFunction(() => document.querySelector(".verdict"), null, { timeout: 15000 })));
  const v = await Promise.all([H, G].map((x) => x.page.evaluate(() => [document.querySelector(".verdict").textContent, document.querySelector("#ra").textContent, document.querySelector("#rb").textContent].join(" "))));
  check(`round ${round}: results on both (${v.join(" | ")})`, v[0].split(" ").slice(1).join() === v[1].split(" ").slice(1).join());
  if (round === 1) await H.page.screenshot({ path: "shots/results-host.png" });
  await G.page.click("#again");
  await H.page.click("#again");
  await H.page.waitForSelector("#start", { timeout: 10000 });
  await H.page.waitForTimeout(800);
}
// A guest leaving mid-match: a bot takes over.
await H.page.click("#start");
await H.page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 20000 });
await G.browser.close();
await H.page.waitForTimeout(8000);
const bot = await H.page.evaluate(() => [...window.__ink.world.players.values()].find((p) => p.id === 1)?.bot);
check("guest left mid-match: a bot took the spot", bot === true);
console.log("errors", H.errors, G.errors);
await H.browser.close();
process.exit(ok.every(([, v]) => v) ? 0 : 1);
