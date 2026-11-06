// Four emulated phones, one online 2 v 2 room: the host makes the room, three friends open the
// link it shows, the host starts; everyone plays; all four must agree on the turf and the result.
// Needs a PeerJS broker the browsers can reach, e.g. a local one:
//   npx peer --port 9000 --host 127.0.0.1
//   node tools/phone-online.mjs "http://127.0.0.1:5420/?broker=ws://127.0.0.1:9000/" [seconds]
import { mkdirSync } from "node:fs";
import { launchBrowser, phone, PHONE, tapOn } from "./phone-lib.mjs";

const URL = process.argv[2] ?? "http://127.0.0.1:5420/?broker=ws://127.0.0.1:9000/";
const SECS = +(process.argv[3] ?? 15);
mkdirSync("shots", { recursive: true });
const ok = [];
const check = (name, v, info = "") => {
  ok.push(v);
  console.log(v ? "PASS" : "FAIL", name, info);
};

const browser = await launchBrowser();
const H = await phone(browser, URL);
await H.touch.tap(PHONE.width / 2, PHONE.height / 2);
await tapOn(H, "#online");
await tapOn(H, "#create");
await H.page.waitForFunction(() => document.querySelector(".status")?.textContent.includes("房间已开好"), null, { timeout: 30000 });
const link = await H.page.textContent("#link");
check("host opened a room", /room=[A-Z0-9]{5}/.test(link) && link.includes("broker="), link);

const G = [];
for (let k = 0; k < 3; k++) G.push(await phone(browser, link));
await H.page.waitForFunction(() => document.querySelectorAll(".slot:not(.bot)").length === 4, null, { timeout: 60000 });
check("three friends joined by link: 4 humans in the lobby", true);
await H.page.screenshot({ path: "shots/online-lobby.png" });

// A fifth phone is turned away: the room holds four.
const late = await phone(browser, link);
await late.page.waitForFunction(() => document.querySelector(".card h1")?.textContent.includes("出了点问题"), null, { timeout: 40000 }).catch(() => undefined);
const lateMsg = await late.page.textContent(".card p").catch(() => "");
check("a fifth player is turned away", lateMsg.includes("已满"), lateMsg);
await late.context.close();

await tapOn(H, "#start");
const all = [H, ...G];
await Promise.all(all.map((x) => x.page.waitForFunction(() => window.__ink.world?.state === "play", null, { timeout: 40000 })));
const teams = await H.page.evaluate(() => [...window.__ink.world.players.values()].map((p) => `${p.team}${p.bot ? "b" : "h"}`).sort().join(","));
check("match: 2 humans a side, no bots", teams === "0h,0h,1h,1h", teams);

// Everyone walks and fires (through the on-screen controls' state).
await Promise.all(
  all.map((x, k) =>
    x.page.evaluate((seed) => {
      let i = seed;
      const t = window.__ink.touch;
      setInterval(() => {
        t.mx = Math.sin(i * 0.7) * 0.6;
        t.my = 0.8;
        t.fire = i % 7 !== 6;
        t.lookDx += Math.sin(i * 0.31) * 18;
        i++;
      }, 300);
    }, k * 11),
  ),
);
const snap = (x) =>
  x.page.evaluate(() => {
    const w = window.__ink.world;
    return { cells: [w.paint.count[0], w.paint.count[1]], turf: [...w.players.values()].map((p) => Math.round(p.turf)).join("/") };
  });
await H.page.waitForTimeout(SECS * 1000);
await Promise.all(all.map((x, k) => x.page.screenshot({ path: `shots/online-${k}.png` })));
// Stop firing and let the last shots land and reach everyone before comparing.
await Promise.all(all.map((x) => x.page.evaluate(() => (window.__ink.touch.fire = false))));
await H.page.waitForTimeout(3000);
const s = await Promise.all(all.map(snap));
console.log(s.map((v, k) => `  phone ${k}: ${JSON.stringify(v)}`).join("\n"));
const painted = s[0].cells[0] + s[0].cells[1];
check("players painted the stage", painted > 200, `${painted} cells`);
check("all four phones see the same turf", s.every((v) => v.cells.join() === s[0].cells.join()));

await H.page.evaluate(() => (window.__ink.world.clock = 1.5));
await Promise.all(all.map((x) => x.page.waitForSelector(".verdict", { timeout: 20000 })));
await H.page.waitForTimeout(1500);
const res = await Promise.all(all.map((x) => x.page.evaluate(() => [document.querySelector(".verdict").textContent, document.querySelector("#ra").textContent, document.querySelector("#rb").textContent])));
console.log(res.map((r, k) => `  phone ${k}: ${r.join(" ")}`).join("\n"));
check("same result on every phone", res.every((r) => r[1] === res[0][1] && r[2] === res[0][2]));
const errs = all.flatMap((x) => x.errors);
check("no page errors", errs.length === 0, errs.join(" | "));
await browser.close();
process.exit(ok.every(Boolean) ? 0 : 1);
