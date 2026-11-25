import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/web/package.json");
const { chromium } = require("playwright");
const [W, H] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 900, isMobile: W < 900 });
const page = await context.newPage();
await page.goto(`http://localhost:5881/?skin=auto`);
await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
await page.getByRole("button", { name: "Play", exact: true }).click();
await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "Map", exact: true }).click();
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const r = [];
  for (const e of document.querySelectorAll("button, .map-dock, .hud, .hud > *, header")) {
    const b = e.getBoundingClientRect();
    if (b.width === 0) continue;
    r.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")} [${e.getAttribute("aria-label") ?? (e.textContent ?? "").trim().slice(0, 20)}] ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} parent=${e.parentElement?.className?.toString().slice(0, 50)}`);
  }
  return r.join("\n");
});
console.log(out);
await browser.close();
