// node shoot.mjs "<job,job>" "<looks>" "<sizes>" [outdir]  ; real in-game shots of the round 4 HCC prototype (presets are sequences; progress hidden while one is built) (yardtester, hccr3_db)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const BASE = "http://localhost:5351";
export const ALL = {
  "l1-hatch": "b9hcc=1&b9hccopt=r3&b9state=filled",
  "l2-hatch": "b9hcc=2&b9hccopt=r3&b9state=filled",
  "l3-hatch": "b9hcc=3&b9hccopt=r3&b9state=filled",
  "l3-hatch-two": "b9hcc=3&b9hccopt=r3",
  "l3-hatch-sent": "b9hcc=3&b9hccopt=r3&b9state=filled,room",
  "l1-presets": "b9hcc=1&b9hccopt=r3&b9state=presets,filled",
  "l2-presets": "b9hcc=2&b9hccopt=r3&b9state=presets,filled",
  "l3-presets": "b9hcc=3&b9hccopt=r3&b9state=presets,filled",
  "l3-presets-scrolled": "b9hcc=3&b9hccopt=r3&b9state=presets,filled",
  "l1-edit": "b9hcc=1&b9hccopt=r3&b9state=presets,filled,edit",
  "l2-building": "b9hcc=2&b9hccopt=r3&b9state=presets,empty,edit,room",
  "l3-edit": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,edit",
  "l3-edit-next": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,edit",
  "l3-edit-ten": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,edit",
  "l3-sent": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,sent,room",
  "l3-sent-locked": "b9hcc=3&b9hccopt=r3&b9state=presets,filled,room",
  "l3-remote-presets": "b9hcc=3&b9hccopt=r3&b9state=remote,presets,filled",
  "l3-remote-edit": "b9hcc=3&b9hccopt=r3&b9state=remote,presets,filled,edit",
};
const tap = async (page, sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(350); };
// What a job does after the tab is open, before its picture.
const AFTER = {
  "l3-edit-next": async (page) => { await tap(page, '.hatch-monster[data-monster="C3"]'); },
  "l3-edit-ten": async (page) => {
    for (const id of ["C3", "C1", "C2", "C4", "C1", "C5"]) { await tap(page, `.hatch-monster[data-monster="${id}"]`); await tap(page, ".b9r3h-set .hatch-add__fill"); }
  },
  "l3-sent-locked": async (page) => { await tap(page, ".b9r3h-row:nth-child(5) .b9r3h-send"); },
  "l3-hatch-sent": async (page) => { await tap(page, ".b9r5h-quick:nth-child(1) .b9r5h-quick__send"); },
  "l3-presets-scrolled": async (page) => { await page.locator(".b9r3h-row:nth-child(3) .b9r3h-row__stacks").evaluate((n) => { n.scrollLeft = 150; return n.scrollLeft; }).then((v) => console.log("scrolled to", v)); await page.waitForTimeout(300); },
};
const jobs = (process.argv[2] || Object.keys(ALL).join(",")).split(",");
const looks = (process.argv[3] || "modern").split(",");
const sizes = (process.argv[4] || "390x844,1280x720").split(",").map((s) => s.split("x").map(Number));
// ONLY=<tag,tag> (env) narrows the run to exact pictures, e.g. l3-edit-classic-390x844
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const OUT = process.argv[5] || `${W}/shots/hcc-r5/work`;
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
        if (AFTER[job]) await AFTER[job](page);
        await page.screenshot({ path: `${OUT}/${tag}.png` });
        const m = await page.evaluate(() => {
          const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && b.width ? [b.x, b.y, b.right, b.bottom].map(Math.round).join(",") : null; };
          const small = [...document.querySelectorAll(".hatch button:not([disabled])")].filter((b) => { const q = b.getBoundingClientRect(); return q.width && (q.height < 43.5 || q.width < 43.5); }).map((b) => `${b.className.split(" ").slice(-1)[0]}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
          const sc = document.querySelector(".hatch__scroll");
          const rr = (n) => { const b = n?.getBoundingClientRect(); return b && b.width ? [b.x, b.y, b.right, b.bottom].map(Math.round).join(",") : null; };
          const strips = [...document.querySelectorAll(".b9r3h-row__stacks")].map((n) => `${n.clientWidth}/${n.scrollWidth}${n.classList.contains("b9r5h-more-right") ? ">" : ""}${n.classList.contains("b9r5h-more-left") ? "<" : ""}`);
          const boxes = [...document.querySelectorAll(".b9r5h-boxes > *")].filter((n) => n.getBoundingClientRect().width).map((n) => n.classList.contains("hatch-slot--empty") ? "_" : n.textContent.replace("✎", "*")).join(" ");
          const vis = (s) => { const n = document.querySelector(s); return n ? n.getBoundingClientRect().height > 0 : null; };
          const bg = (q) => { const n = document.querySelector(q); return n ? getComputedStyle(n).backgroundColor + "/" + getComputedStyle(n).color + "/" + getComputedStyle(n).opacity : null; };
          return { cnt: [bg("div.b9r5h-box:not(.hatch-slot--empty) .hatch-slot__count"), bg("button.b9r5h-box .hatch-slot__count"), bg(".hatch-line__slots .hatch-slot__count")], strips, boxes, left: document.querySelector(".b9r3h-edit__stacks")?.textContent, said: document.querySelector(".b9r3h-said")?.textContent, bench: r(".b9r2h-bench"), lines: r(".hatch-lines"), rail: r(".b9r5h-rail"), quick: rr(document.querySelector(".b9r5h-quick")), rows: document.querySelectorAll(".b9r3h-row").length, lastRow: rr([...document.querySelectorAll(".b9r3h-row")].at(-1)), edit: r(".b9r3h-edit"), tabs: r(".b9r3h-tabs"), list: r(".b9r3h-presets"), add: r(".hatch-info"), win: r(".monsters-screen"), hatch: r(".hatch"), scroll: sc ? `${sc.clientHeight}/${sc.scrollHeight}` : null, small: [...new Set(small)].slice(0, 12) };
        });
        console.log("ok", tag, JSON.stringify(m));
      } catch (e) { console.error("ERR", tag, String(e).slice(0, 300)); await page.screenshot({ path: `${OUT}/ERR-${tag}.png` }).catch(() => {}); }
    }
    await context.close();
  }
} finally { await browser.close(); }
