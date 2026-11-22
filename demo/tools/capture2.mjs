// Second pass: backdrops (game with the window hidden), each monster's info card, the add panel with a count.
import { createRequire } from "node:module";
import fs from "node:fs";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const BASE = "http://localhost:5351"; const OUT = `${W}/demo/capture`;
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
for (const [w, h] of [[390, 844], [1280, 720]]) {
  const phone = w <= 620;
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
  await page.goto(`${BASE}/?skin=auto`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.goto(`${BASE}/?skin=auto&b9hcc=3&b9hccopt=d&b9state=remote`);
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByRole("button", { name: /^Monsters/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  if (!phone) {
    const out = {};
    const ids = await page.$$eval(".hatch-monster--ready", (ns) => ns.map((n) => n.dataset.monster));
    for (const id of ids) {
      await page.evaluate((id) => document.querySelector(`.hatch-monster[data-monster=${id}]`).click(), id);
      await page.waitForTimeout(250);
      out[id] = await page.evaluate(() => ({ info: document.querySelector(".hatch-info")?.outerHTML, add: document.querySelector(".hatch-add")?.outerHTML, cell: document.querySelector(".hatch-monster[aria-pressed=true]")?.outerHTML }));
    }
    await page.evaluate(() => document.querySelector(".hatch-monster[data-monster=C12]").click());
    await page.waitForTimeout(250);
    for (const sel of [".hatch-add__jump:last-of-type", ".hatch-add__step--plus"]) { await page.evaluate((s) => [...document.querySelectorAll(".hatch-add__jump")].pop().click(), sel); await page.waitForTimeout(250); }
    out.counted = await page.evaluate(() => ({ add: document.querySelector(".hatch-add")?.outerHTML, split: document.querySelector(".hatch-message")?.outerHTML, status: document.querySelector(".hatch__status")?.outerHTML, lines: document.querySelector(".hatch-lines")?.outerHTML }));
    await page.screenshot({ path: `${OUT}/counted-${w}x${h}.png` });
    await page.evaluate(() => document.querySelector(".hatch-add__fill").click()); await page.waitForTimeout(300);
    out.maxed = await page.evaluate(() => ({ add: document.querySelector(".hatch-add")?.outerHTML, split: document.querySelector(".hatch-message")?.outerHTML, status: document.querySelector(".hatch__status")?.outerHTML, value: document.querySelector(".hatch-add__count").value }));
    await page.screenshot({ path: `${OUT}/maxed-${w}x${h}.png` });
    fs.writeFileSync(`${OUT}/monsters.json`, JSON.stringify(out));
  }
  await page.evaluate(() => { document.querySelector(".monsters-screen").style.visibility = "hidden"; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/backdrop-${w}x${h}.png` });
  console.log("ok", w);
  await context.close();
}
await browser.close();
