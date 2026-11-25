// Shared: open the game as yardtester on the map.
import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/web/package.json");
export const { chromium } = require("playwright");
export const EXE = "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell";
export const SHOTS = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/shots";

export async function openMap({ skin, W, H, scale = 1, query = "", video = null }) {
  const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: EXE });
  const mobile = W < 900;
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: scale,
    hasTouch: mobile,
    isMobile: mobile,
    ...(video ? { recordVideo: { dir: video, size: { width: W, height: H } } } : {}),
  });
  await context.addInitScript((k) => {
    try {
      if (k === "classic") localStorage.setItem("bymr.look", "classic");
      else localStorage.removeItem("bymr.look");
    } catch {}
  }, skin);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
  const t0 = Date.now();
  await page.goto(`http://localhost:5881/?skin=auto${query}`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const prep = page.getByRole("button", { name: "Prepare defences" });
  if (await prep.isVisible().catch(() => false)) await prep.click();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForFunction(() => !!globalThis.__liveDemo, null, { timeout: 60000 });
  await page.waitForTimeout(10000);
  return { browser, context, page, t0 };
}

export const demo = (page, js) => page.evaluate(js);
