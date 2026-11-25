// Baseline map shots: node base.mjs <modern|classic> <w> <h> <scale> <outname>
import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/web/package.json");
const { chromium } = require("playwright");
const [skin, w, h, s, out] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const dir = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/shots/base";
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const mobile = W < 900;
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(s), hasTouch: mobile, isMobile: mobile });
await context.addInitScript((k) => { try { if (k === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, skin);
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
try {
  await page.goto(`http://localhost:5881/?skin=auto`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  const prep = page.getByRole("button", { name: "Prepare defences" });
  if (await prep.isVisible().catch(() => false)) await prep.click();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${dir}/${out}-map.png` });
  const cx = W / 2 + Number(process.argv[7] ?? 0), cy = H / 2 + Number(process.argv[8] ?? 0);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/${out}-panel.png` });
} catch (e) {
  await page.screenshot({ path: `${dir}/${out}-error.png` }).catch(() => {});
  console.error("FAILED", String(e).slice(0, 400));
}
await context.close();
await browser.close();
