// node shoot.mjs "<job,job>" "<looks>" "<sizes>" [outdir]  ; real in-game shots of the round 3 HCC prototype (yardtester, hccr3_db)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const BASE = "http://localhost:5351";
export const ALL = {
  "today": "",
  "l2-monsters": "b9hcc=2&b9hccopt=r3",
  "l2-presets": "b9hcc=2&b9hccopt=r3&b9state=presets,filled",
  "l2-presets-empty": "b9hcc=2&b9hccopt=r3&b9state=presets,empty,room",
  "l2-building": "b9hcc=2&b9hccopt=r3&b9state=presets,empty,edit,room",
  "l2-sent": "b9hcc=2&b9hccopt=r3&b9state=presets,filled,sent,room",
  "l2-housing": "b9hcc=2&b9hccopt=r3&b9state=presets,filled,housing",
  "l3-monsters": "b9hcc=3&b9hccopt=r3",
  "l3-presets": "b9hcc=3&b9hccopt=r3&b9state=presets,filled",
  "l3-presets-empty": "b9hcc=3&b9hccopt=r3&b9state=presets,empty,room",
  "l3-building": "b9hcc=3&b9hccopt=r3&b9state=presets,empty,edit,room",
  "l3-edit": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,edit",
  "l3-sent": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,sent,room",
  "l3-remote": "b9hcc=3&b9hccopt=r3&b9state=remote",
  "l3-remote-presets": "b9hcc=3&b9hccopt=r3&b9state=remote,presets,filled",
  "l3-remote-sent": "b9hcc=3&b9hccopt=r3&b9state=remote,presets,filled,sent",
  "l3-yards": "b9hcc=3&b9hccopt=r3&b9state=yards",
};
const jobs = (process.argv[2] || Object.keys(ALL).join(",")).split(",");
const looks = (process.argv[3] || "modern").split(",");
const sizes = (process.argv[4] || "390x844,1280x720").split(",").map((s) => s.split("x").map(Number));
// ONLY=<tag,tag> (env) narrows the run to exact pictures, e.g. l3-edit-classic-390x844
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const OUT = process.argv[5] || `${W}/shots/hcc-r3/work`;
const count = () => Number(execSync("pgrep -af chrome-headless-shell | grep -vc -- '--type=' || true").toString().trim() || 0);
for (let i = 0; i < 120 && count() >= 3; i++) await new Promise((r) => setTimeout(r, 5000));
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
try {
  for (const look of looks) for (const [w, h] of sizes) {
    const mine = jobs.filter((job) => !ONLY || ONLY.has(`${job}-${look}-${w}x${h}`));
    if (!mine.length) continue;
    const phone = w <= 620 || h <= 500;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
    await context.addInitScript((s) => { try { if (s === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, look);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
    await page.goto(`${BASE}/?skin=auto`);
    await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
    await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
    await page.waitForTimeout(3500);
    for (const job of mine) {
      const tag = `${job}-${look}-${w}x${h}`;
      try {
        await page.goto(`${BASE}/?skin=auto&${ALL[job]}`);
        await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
        await page.waitForTimeout(3000);
        for (const name of ["Prepare defences", "Close", "OK"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); } }
        await page.keyboard.press("Escape").catch(() => {});
        await page.getByRole("button", { name: /^Monsters/ }).first().click();
        await page.waitForTimeout(1200);
        await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${OUT}/${tag}.png` });
        const m = await page.evaluate(() => {
          const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && b.width ? [b.x, b.y, b.right, b.bottom].map(Math.round).join(",") : null; };
          const small = [...document.querySelectorAll(".hatch button:not([disabled])")].filter((b) => { const q = b.getBoundingClientRect(); return q.width && (q.height < 43.5 || q.width < 43.5); }).map((b) => `${b.className.split(" ").slice(-1)[0]}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
          const sc = document.querySelector(".hatch__scroll");
          return { tabs: r(".b9r3h-tabs"), list: r(".b9r3h-presets"), add: r(".hatch-info"), win: r(".monsters-screen"), scroll: sc ? `${sc.clientHeight}/${sc.scrollHeight}` : null, small: [...new Set(small)].slice(0, 12) };
        });
        console.log("ok", tag, JSON.stringify(m));
      } catch (e) { console.error("ERR", tag, String(e).slice(0, 300)); await page.screenshot({ path: `${OUT}/ERR-${tag}.png` }).catch(() => {}); }
    }
    await context.close();
  }
} finally { await browser.close(); }
