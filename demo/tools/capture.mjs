// Captures the prototype's real DOM, CSS and backdrop from the running game (ports 5351/3351).
import { createRequire } from "node:module";
import fs from "node:fs";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const BASE = "http://localhost:5351"; const OUT = `${W}/demo/capture`;
const JOBS = { "now": "", "r3-l2": "b9hcc=2&b9hccopt=r3", "r3-l3-remote": "b9hcc=3&b9hccopt=r3&b9state=remote", "r3-l3-yards": "b9hcc=3&b9hccopt=r3&b9state=yards" };
const only = process.argv[2] ? process.argv[2].split(",") : Object.keys(JOBS);
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
  for (const name of ["Prepare defences", "Close", "OK"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); } }
  for (const job of only) {
    const tag = `${job}-${w}x${h}`;
    try {
      await page.goto(`${BASE}/?skin=auto&${JOBS[job]}`);
      await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
      await page.waitForTimeout(3000);
      await page.keyboard.press("Escape").catch(() => {});
      await page.getByRole("button", { name: /^Monsters/ }).first().click();
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/${tag}.png` });
      const data = await page.evaluate(() => {
        const hatch = document.querySelector(".hatch");
        // the outermost element that only exists for the window: child of body-level layer
        let win = hatch; const chain = [];
        while (win.parentElement && win.parentElement !== document.body) win = win.parentElement;
        for (let n = win; n; n = n.parentElement) chain.push({ tag: n.tagName, cls: n.className, style: n.getAttribute("style"), attrs: [...n.attributes].filter((a) => !["class", "style"].includes(a.name)).map((a) => [a.name, a.value]) });
        const sibs = [...document.body.children].map((n) => `${n.tagName}.${String(n.className).slice(0, 80)}#${n.id}`);
        const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? [b.x, b.y, b.width, b.height].map(Math.round) : null; };
        return { html: win.outerHTML, chain, sibs, rootFont: getComputedStyle(document.documentElement).fontSize, bodyFont: getComputedStyle(document.body).fontFamily,
          rects: { hatch: r(".hatch"), win: r(".b9r2h-window"), mixcard: r(".b9r2h-mixcard") }, fonts: [...document.fonts].map((f) => `${f.family}|${f.weight}|${f.status}`) };
      });
      fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(data));
      if (job === "r3-l3-remote" || job === "now") {
        const css = await page.evaluate(async () => { const out = []; for (const s of document.styleSheets) { let text = ""; try { text = [...s.cssRules].map((x) => x.cssText).join("\n"); } catch (e) { text = "/* blocked " + s.href + " */"; } out.push({ id: s.ownerNode?.getAttribute?.("data-vite-dev-id") || s.href || "inline", text }); } return out; });
        fs.writeFileSync(`${OUT}/css-${tag}.json`, JSON.stringify(css));
      }
      if (job === "never") { // backdrop: the game with the window hidden
        await page.evaluate(() => { let win = document.querySelector(".hatch"); while (win.parentElement && win.parentElement !== document.body) win = win.parentElement; win.style.visibility = "hidden"; });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/backdrop-${w}x${h}.png` });
      }
      console.log("ok", tag, data.html.length);
    } catch (e) { console.error("ERR", tag, String(e).slice(0, 300)); }
  }
  await context.close();
}
await browser.close();
