import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** Online play only pairs identical builds (same commit). */
function buildId(): string {
  try {
    return execSync("git rev-parse --short=10 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/ink-rush/" : "./",
  define: { __BUILD__: JSON.stringify(process.env.INK_BUILD ?? buildId()) },
  server: { port: 5421, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
