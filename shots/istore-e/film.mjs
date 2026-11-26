// film.mjs <name> <modern|classic> <w> <h> <scale> <building id> <zoom steps> [quality]
// One real in-game shot of yardtester's Inferno yard (my own server 5381, database copy istore_e_db): logs in, goes
// down the cave, centres the building with the dev hook __yardSelect, closes its pop-up, zooms and shoots.
import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/istore-r2/web/package.json");
const { chromium } = require("playwright");
const [name, look, w, h, scale, id, zoom, quality] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const out = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/istore-r2/shots/istore-e/game";
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(scale) });
await context.addInitScript((s) => { try { if (s === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, look);
const page = await context.newPage();
const asked = [];
page.on("request", (r) => { if (r.url().includes("generalstore")) asked.push(r.url().split("/").pop()); });
const drag = async (dx, dy) => {
  const n = Math.ceil(Math.max(Math.abs(dx) / (W * 0.4), Math.abs(dy) / (H * 0.3)));
  for (let i = 0; i < n; i++) {
    await page.mouse.move(W / 2 - dx / n / 2, H / 2 - dy / n / 2);
    await page.mouse.down();
    await page.mouse.move(W / 2 + dx / n / 2, H / 2 + dy / n / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
};
const closePopups = async () => {
  for (let i = 0; i < 4; i++) {
    const ok = page.getByRole("button", { name: /^(OK|Close|Got it|Later)$/ }).first();
    if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); await page.waitForTimeout(500); } else break;
  }
};
try {
  await page.goto(`http://localhost:5381/${quality ? `?quality=${quality}` : ""}`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000);
  await closePopups();
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
  await page.waitForTimeout(600);
  // the cave stands up and left of the yard; where it is on this screen comes in CAVE=x,y (none: just a picture to find it)
  await page.screenshot({ path: `${out}/_cave-${name}.png` });
  if (!process.env.CAVE) throw new Error("no CAVE given: see the _cave picture");
  const [cx, cy] = process.env.CAVE.split(",").map(Number);
  let found = false;
  for (const [ox, oy] of [[0, 0], [0, -15], [-20, 0], [20, 0], [0, 15]]) {
    await page.mouse.click(cx + ox, cy + oy);
    await page.waitForTimeout(900);
    const enter = page.getByRole("button", { name: /Enter Cavern/ }).first();
    if (await enter.isVisible().catch(() => false)) { await enter.click(); found = true; break; }
    await page.keyboard.press("Escape");
  }
  if (!found) throw new Error("cave not found");
  await page.waitForFunction(() => typeof window.__yardSelect === "function", null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await closePopups();
  const note = page.getByText("Repair all").locator("xpath=ancestor::*[count(.//button) > 1][1]").locator("button").last();   // the banner's own x
  if (await note.isVisible().catch(() => false)) await note.click().catch(() => {});
  const ok = await page.evaluate((n) => window.__yardSelect(n), Number(id));
  if (!ok) throw new Error("building not in this yard");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.mouse.move(W / 2, H / 2);
  const z = Number(zoom);
  for (let i = 0; i < Math.abs(z); i++) { await page.mouse.wheel(0, z > 0 ? -300 : 300); await page.waitForTimeout(150); }
  await page.evaluate((n) => window.__yardSelect(n), Number(id));
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.mouse.move(W - 5, H / 2);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${out}/${name}-b.png` });
  console.log(name, "asked", [...new Set(asked)].join(" "));
} catch (e) {
  await page.screenshot({ path: `${out}/_fail-${name}.png` }).catch(() => {});
  console.log("FAIL", name, String(e).slice(0, 300));
} finally {
  await browser.close();
}
