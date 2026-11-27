// node snap.mjs <modern|classic> <high|medium|low> <w> <h> <scale> <out-prefix> <steps> [query]
// steps: yard, fit (zoom out once), zoomin, events, card, cardMid, map, wait:N, crop:x:y:w:h (from last shot, 2x)
import { createRequire } from "node:module";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/xmas-calendar/web/package.json");
const { chromium } = require("playwright");
const [skin, quality, w, h, scale, name, stepsArg, query = ""] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const dir = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/xmas-calendar/xmas-shots";
const steps = stepsArg.split(",");
const browser = await chromium.launch({ args: ["--mute-audio", "--use-gl=angle", "--use-angle=swiftshader"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const mobile = W < 900 || H < 500;
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(scale), hasTouch: mobile, isMobile: mobile && W < 900 });
await context.addInitScript(([s, q]) => {
  try {
    if (s === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look");
    localStorage.setItem("bymr.quality", q);
    localStorage.setItem("bymr.music", "flash");
  } catch {}
}, [skin, quality]);
const page = await context.newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
let last = null;
try {
  await page.goto(`http://localhost:5421/?${query}`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(9000);
  for (const step of steps) {
    const [kind, ...args] = step.split(":");
    if (kind === "yard") {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(600);
      last = `${dir}/${name}-yard.png`;
      await page.screenshot({ path: last });
    } else if (kind === "fit" || kind === "zoomin") {
      await page.keyboard.press("Escape").catch(() => {});
      const n = Number(args[0] ?? 1);
      for (let i = 0; i < n; i++) {
        await page.getByRole("button", { name: kind === "fit" ? /^Zoom out/ : /^Zoom in/ }).first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(2500);
      last = `${dir}/${name}-${kind}${n}.png`;
      await page.screenshot({ path: last });
    } else if (kind === "events") {
      await page.getByRole("button", { name: /^Events/ }).first().click();
      await page.waitForTimeout(2500);
      last = `${dir}/${name}-events.png`;
      await page.screenshot({ path: last });
    } else if (kind === "card" || kind === "cardMid") {
      await page.evaluate((mid) => {
        const card = document.querySelector(".events-card--christmas");
        if (!card) return;
        if (mid) card.querySelector(".events-ladder")?.scrollIntoView({ block: "start" });
        else card.scrollIntoView({ block: "start" });
      }, kind === "cardMid");
      await page.waitForTimeout(800);
      last = `${dir}/${name}-${kind}.png`;
      await page.screenshot({ path: last });
    } else if (kind === "close") {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(800);
    } else if (kind === "map") {
      await page.getByRole("button", { name: "Map", exact: true }).click();
      await page.waitForTimeout(Number(args[0] ?? 20000));
      last = `${dir}/${name}-map.png`;
      await page.screenshot({ path: last });
    } else if (kind === "wait") {
      await page.waitForTimeout(Number(args[0]));
    } else if (kind === "drag") {
      const [x1, y1, x2, y2] = args.map(Number);
      await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); await page.mouse.up();
      await page.waitForTimeout(1500);
    } else if (kind === "shot") {
      last = `${dir}/${name}-${args[0]}.png`;
      await page.screenshot({ path: last });
    }
  }
  const odd = requests.filter((u) => /snow|winter|christmas|present/i.test(u)).map((u) => u.replace(/^https?:\/\/[^/]+/, ""));
  console.log("winter requests:", JSON.stringify([...new Set(odd)]));
} catch (e) {
  console.log("FAIL", e.message);
  await page.screenshot({ path: `${dir}/${name}-fail.png` }).catch(() => {});
} finally {
  await browser.close();
}
