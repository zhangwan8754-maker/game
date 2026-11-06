// Headless Chromium on the real GPU (Vulkan ANGLE on Linux).
import { chromium } from "playwright";
export async function launch({ width = 1280, height = 720, url = process.env.INK_URL ?? "http://localhost:5421/" } = {}) {
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("pageerror", (e) => errors.push("page: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ink, null, { timeout: 30000 });
  return { browser, page, errors };
}
