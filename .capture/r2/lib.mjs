import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/screens-r2/web/package.json");
export const { chromium } = require("playwright");
export const BASE = "http://localhost:5391";
export const SHOTS = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/screens-r2/shots";
import { execSync } from "node:child_process";
const count = () => Number(execSync("pgrep -af chrome-headless-shell | grep -vc -- '--type=' || true").toString().trim() || 0);
export const launch = async () => { for (let i = 0; i < 120 && count() >= 3; i++) await new Promise((r) => setTimeout(r, 5000)); return launch0(); };
const launch0 = () => chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
export async function open(browser, { w, h, look, scale, query = "" }) {
  const phone = w <= 620 || h <= 500;
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale ?? (phone ? 3 : 1), hasTouch: phone, isMobile: phone });
  await context.addInitScript((s) => { try { if (s === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, look);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
  await page.goto(`${BASE}/?skin=auto${query}`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(3500);
  for (const name of ["Prepare defences", "Close", "OK"]) {
    const b = page.getByRole("button", { name, exact: true }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { context, page };
}
export const shot = (page, name, clip) => page.screenshot({ path: `${SHOTS}/${name}.png`, ...(clip ? { clip } : {}) });
export async function crop(page, selector, name, pad = 8) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) { console.error("no box", selector); return; }
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const clip = { x, y, width: Math.min(vp.width - x, box.width + 2 * pad), height: Math.min(vp.height - y, box.height + 2 * pad) };
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip, scale: "device" });
}
