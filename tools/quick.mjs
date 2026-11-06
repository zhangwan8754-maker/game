// Quick match: three players press Quick match; they should land in one lobby.
import { launch } from "./gpu.mjs";
const BASE = process.env.INK_URL ?? "http://localhost:5421/";
const P = [];
for (let k = 0; k < 3; k++) {
  const x = await launch({ url: BASE, width: 800, height: 450 });
  await x.page.keyboard.press("Enter");
  await x.page.click("#online");
  await x.page.click("#quick");
  P.push(x);
  await x.page.waitForTimeout(3000);
}
await P[0].page.waitForTimeout(4000);
const r = await Promise.all(P.map((x) => x.page.evaluate(() => ({ role: window.__ink.role, humans: document.querySelectorAll(".slot:not(.bot)").length, status: document.querySelector(".status")?.textContent }))));
console.log(JSON.stringify(r), P.map((x) => x.errors));
for (const x of P) await x.browser.close();
