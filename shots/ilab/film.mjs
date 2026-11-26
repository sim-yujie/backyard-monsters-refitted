// film.mjs <name> <modern|classic> <w> <h> <scale> [steps...]
// Real in-game shots of yardtester's Inferno yard (helper lab-build: server 3391, vite 5391, database copy
// lab_build_db). Logs in, goes down the cave (CAVE=x,y on the zoomed-out main yard), then runs the steps:
//   sel:<id>        centre building <id> with the dev hook __yardSelect (its pop-up stays open)
//   esc             press Escape
//   zoom:<n>        mouse-wheel n steps (positive = in)
//   click:<text>    click the first button whose name matches <text> (regex)
//   wait:<ms>       wait
//   shot:<label>    screenshot to game/<name>-<label>.png
import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/web/package.json");
const { chromium } = require("playwright");
const [name, look, w, h, scale, ...steps] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const out = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/game";
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(scale), ...(process.env.VIDEO ? { recordVideo: { dir: `${out}/video`, size: { width: W * Number(scale), height: H * Number(scale) } } } : {}) });
await context.addInitScript((s) => { try { if (s === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, look);
const page = await context.newPage();
const T0 = Date.now();
const closePopups = async () => {
  for (let i = 0; i < 4; i++) {
    const ok = page.getByRole("button", { name: /^(OK|Close|Got it|Later)$/ }).first();
    if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); await page.waitForTimeout(500); } else break;
  }
};
try {
  await page.goto("http://localhost:5391/");
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(5000);
  await closePopups();
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
  await page.waitForTimeout(600);
  if (process.env.PAN) {
    const [dx, dy] = process.env.PAN.split(",").map(Number);
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.down();
    await page.mouse.move(W / 2 + dx, H / 2 + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
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
  for (const step of steps) {
    const [op, ...rest] = step.split(":");
    const arg = rest.join(":");
    if (op === "sel") { const ok = await page.evaluate((n) => window.__yardSelect(n), Number(arg)); if (!ok) throw new Error(`no building ${arg}`); await page.waitForTimeout(900); }
    else if (op === "esc") { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
    else if (op === "zoom") { await page.mouse.move(W / 2, H / 2); const z = Number(arg); for (let i = 0; i < Math.abs(z); i++) { await page.mouse.wheel(0, z > 0 ? -300 : 300); await page.waitForTimeout(150); } await page.waitForTimeout(500); }
    else if (op === "try") { const b = page.getByRole("button", { name: new RegExp(arg) }).first(); if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200); } }
    else if (op === "click") { const b = page.getByRole("button", { name: new RegExp(arg) }).first(); await b.click({ timeout: 10000 }); await page.waitForTimeout(1200); }
    else if (op === "tab") { await page.getByRole("tab", { name: new RegExp(arg) }).first().click({ timeout: 10000 }); await page.waitForTimeout(1000); }
    else if (op === "text") { await page.getByText(new RegExp(arg)).first().click({ timeout: 10000 }); await page.waitForTimeout(900); }
    else if (op === "wait") await page.waitForTimeout(Number(arg));
    else if (op === "css") { const el = page.locator(arg).first(); await el.scrollIntoViewIfNeeded(); await el.click({ timeout: 10000 }); await page.waitForTimeout(900); }
    else if (op === "clean") {
      // the attacked banner's own x, and the world chat folded away
      const note = page.getByText("Repair all").locator("xpath=ancestor::*[count(.//button) > 1][1]").locator("button").last();
      if (await note.isVisible().catch(() => false)) await note.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    else if (op === "away") { await page.mouse.move(W - 5, H / 2); await page.waitForTimeout(300); }
    else if (op === "shot") await page.screenshot({ path: `${out}/${name}-${arg}.png` });
    else if (op === "buttons") { const n = await page.getByRole("button").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getAttribute("aria-label") || e.textContent.trim()).filter(Boolean)); console.log(n.join(" | ").slice(0, 2500)); }
    else if (op === "fill") { await page.getByRole("button", { name: `More ${arg}` }).locator("xpath=following-sibling::button[1]").click({ timeout: 10000 }).catch(async () => { await page.getByRole("button", { name: `More ${arg}` }).click(); }); await page.waitForTimeout(500); }
    else if (op === "more") { const [who, n] = arg.split(","); for (let i = 0; i < Number(n); i++) { await page.getByRole("button", { name: `More ${who}` }).click(); await page.waitForTimeout(120); } }
    else if (op === "tap") { const [x, y] = arg.split(",").map(Number); await page.mouse.click(x, y); await page.waitForTimeout(400); }
    else if (op === "mark") console.log("MARK", arg, ((Date.now() - T0) / 1000).toFixed(1));
    else if (op === "html") { const t = await page.locator(arg || "body").first().innerText().catch((e) => String(e)); console.log(t.slice(0, 3000)); }
    else throw new Error(`unknown step ${step}`);
  }
  console.log("OK", name);
} catch (e) {
  await page.screenshot({ path: `${out}/_fail-${name}.png` }).catch(() => {});
  console.log("FAIL", name, String(e).slice(0, 400));
} finally {
  await context.close();
  await browser.close();
}
