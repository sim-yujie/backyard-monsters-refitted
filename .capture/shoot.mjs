// Tier plate pictures: node shoot.mjs <classic|modern> <tag> [phases]
// phases (comma list): home, phone, crops, attack, patk, inferno, iphone, icrops
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const W0 = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/tier-build";
const require = createRequire(`${W0}/web/package.json`);
const { chromium } = require("playwright");
const [skin, tag, phasesArg] = process.argv.slice(2);
const phases = new Set((phasesArg || "home,phone,crops").split(","));
const dir = `${W0}/.capture/shots/${tag}`;
mkdirSync(dir, { recursive: true });
const URL = "http://localhost:5391/";
const TOWERS = [20, 21, 22, 23, 25, 115, 118, 129, 130, 132, 136, 137];
const browser = await chromium.launch({ executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell", args: ["--mute-audio", "--use-gl=angle", "--use-angle=swiftshader"] });

async function open(viewport, scale, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: mobile, isMobile: mobile });
  await context.addInitScript((s) => {
    try {
      if (s === "classic") localStorage.setItem("bymr.look", "classic");
      else localStorage.removeItem("bymr.look");
    } catch {}
  }, skin);
  const page = await context.newPage();
  page.yards = [];
  page.on("pageerror", (e) => console.error("pageerror", String(e).slice(0, 200)));
  page.on("response", async (r) => {
    if (!/\/base\/load|\/bm\/inferno/.test(r.url())) return;
    try { const j = await r.json(); if (j && j.buildingdata) page.yards.push(j); } catch {}
  });
  await page.goto(URL);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(6000);
  await dismiss(page);
  return { context, page };
}

async function dismiss(page) {
  for (let i = 0; i < 2; i += 1) {
    for (const name of ["Prepare defences", "Close", "OK", "Later", "Got it"]) {
      const b = page.getByRole("button", { name, exact: true }).first();
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(800);
  }
}

/** The last loaded yard's buildings, read by the game's own readYard. */
const list = async (page) => {
  const resp = page.yards[page.yards.length - 1];
  return page.evaluate(async (r) => {
    const m = await import("/src/game/yard/yardModel.ts");
    return m.readYard(r).buildings.map((b) => ({ id: b.id, type: b.type, level: b.level, fort: b.fortification, cx: b.centreX, cy: b.centreY, wx: b.worldX, wy: b.worldY }));
  }, resp);
};
const cam = (page, fn, arg) => page.evaluate(([f, a]) => {
  const c = globalThis.__bymrCamera;
  if (f === "focus") { c.zoomAt(a.zoom, { x: c.viewportWidth / 2, y: c.viewportHeight / 2 }); c.centreOn({ x: a.x, y: a.y }); c.settle?.(); return { zoom: c.zoom }; }
  if (f === "screen") return c.worldToScreen({ x: a.x, y: a.y });
  if (f === "zoom") return c.zoom;
}, [fn, arg]);

/** One 2x crop round each tower's plate, at game zoom 1. */
async function crops(page, prefix) {
  const all = (await list(page)).filter((b) => TOWERS.includes(b.type));
  writeFileSync(`${dir}/${prefix}towers.json`, JSON.stringify(all, null, 1));
  for (const b of all) {
    await cam(page, "focus", { x: b.cx, y: b.cy - 30, zoom: 1 });
    await page.waitForTimeout(700);
    const s = await cam(page, "screen", { x: b.cx, y: b.cy - 30 });
    await page.screenshot({ path: `${dir}/${prefix}crop-${b.type}-L${b.level}-${b.id}.png`, clip: { x: s.x - 75, y: s.y - 100, width: 150, height: 180 } });
  }
}

async function toInferno(page) {
  // The yard scene takes a pending own-yard target on its next entry (`ownYards.ts`): set the Inferno's,
  // go to the map and back.
  const n = page.yards.length;
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForTimeout(5000);
  await page.evaluate(async () => {
    const m = await import("/src/game/yard/ownYards.ts");
    m.setOwnYardTarget(m.INFERNO_YARD);
  });
  for (const name of [/^Yard$/]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
  }
  for (let i = 0; i < 60 && page.yards.length === n; i += 1) await page.waitForTimeout(500);
  await page.waitForTimeout(7000);
  await dismiss(page);
  const last = page.yards[page.yards.length - 1];
  console.log("yard type now", last?.type, page.yards.length, n);
  if (last?.type !== "inferno") console.error("map buttons", (await page.getByRole("button").allInnerTexts()).slice(0, 30).join("|"));
  return last?.type === "inferno";
}

async function attack(page, tag) {
  const baiter = (await list(page)).find((b) => b.type === 19);
  if (!baiter) { console.error("no baiter"); return; }
  const z = await cam(page, "zoom");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await cam(page, "focus", { x: baiter.cx, y: baiter.cy, zoom: z });
    await page.waitForTimeout(1500);
    const s = await cam(page, "screen", { x: baiter.cx, y: baiter.cy - 10 - attempt * 6 });
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(1500);
    const opener = page.getByRole("button", { name: /^(Open|Test|Test attack|Baiter)/ }).first();
    if (await opener.isVisible().catch(() => false)) await opener.click().catch(() => {});
    await page.waitForTimeout(1500);
    if (await page.getByRole("button", { name: "Start test" }).isVisible().catch(() => false)) break;
  }
  const more = page.getByRole("button", { name: /^More / });
  const n = await more.count();
  for (let i = Math.max(0, n - 4); i < n; i += 1) for (let k = 0; k < 4; k += 1) await more.nth(i).click().catch(() => {});
  await page.getByRole("button", { name: "Start test" }).click();
  await page.waitForTimeout(3000);
  const W = page.viewportSize().width;
  const zoomNow = await cam(page, "zoom");
  // The row of test towers at Y 500 (ids 9001-9006, 9101-9103): drop round it.
  const group = { x: 1190, y: 1150 };
  await cam(page, "focus", { x: group.x, y: group.y, zoom: W < 600 ? 0.4 : zoomNow });
  await page.waitForTimeout(800);
  const tries = Array.from({ length: 48 }, (_, i) => { const r = 220 + Math.floor(i / 16) * 70; const t = (i % 16) / 16 * Math.PI * 2; return [group.x + Math.cos(t) * r, group.y + Math.sin(t) * r * 0.6]; });
  let dropped = 0;
  for (const [x, y] of tries) {
    if (dropped >= (W < 600 ? 4 : 8)) break;
    const ok = await page.evaluate(([wx, wy]) => {
      const a = window.__attack;
      if (!a) return "no hook";
      if (a.bucket.isEmpty()) a.bucket.fillAll();
      return a.input.tapAt({ x: wx, y: wy });
    }, [x, y]);
    if (ok === true) dropped += 1;
    await page.waitForTimeout(100);
  }
  console.log("drops", dropped);
  await cam(page, "focus", { x: group.x, y: group.y - 40, zoom: zoomNow });
  for (const t of [8, 18, 30]) {
    await page.waitForTimeout(t === 8 ? 8000 : 10000);
    await page.screenshot({ path: `${dir}/attack-${tag}-${t}s.png` });
  }
}

try {
  if (phases.has("home") || phases.has("crops") || phases.has("attack")) {
    const { context, page } = await open({ width: 1280, height: 720 }, 1, false);
    const all = await list(page);
    console.log("yard buildings", all.length, "towers", all.filter((b) => TOWERS.includes(b.type)).length, "zoom", await cam(page, "zoom"));
    if (phases.has("home")) await page.screenshot({ path: `${dir}/home-desktop.png` });
    if (phases.has("attack")) await attack(page, "desktop");
    await context.close();
  }
  if (phases.has("crops")) {
    const { context, page } = await open({ width: 1280, height: 720 }, 2, false);
    await crops(page, "");
    await context.close();
  }
  if (phases.has("phone") || phases.has("patk")) {
    const { context, page } = await open({ width: 390, height: 844 }, 3, true);
    console.log("phone zoom", await cam(page, "zoom"));
    if (phases.has("phone")) await page.screenshot({ path: `${dir}/home-phone.png` });
    if (phases.has("patk")) await attack(page, "phone");
    await context.close();
  }
  if (phases.has("inferno") || phases.has("icrops")) {
    const { context, page } = await open({ width: 1280, height: 720 }, phases.has("icrops") ? 2 : 1, false);
    if (await toInferno(page)) {
      if (phases.has("inferno")) await page.screenshot({ path: `${dir}/inferno-desktop.png`, scale: "css" });
      if (phases.has("icrops")) await crops(page, "inf-");
    }
    await context.close();
  }
  if (phases.has("iphone")) {
    const { context, page } = await open({ width: 390, height: 844 }, 3, true);
    if (await toInferno(page)) await page.screenshot({ path: `${dir}/inferno-phone.png` });
    await context.close();
  }
} catch (e) {
  console.error("FAILED", String(e).slice(0, 500));
}
await browser.close();
console.log("done", tag);
