// node shots.mjs [filter]  -> demo/shots/<name>.png. Opens demo/index.html from file:// with the network blocked.
import { createRequire } from "node:module";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-demo";
const require = createRequire(`${W}/web/package.json`);
const { chromium, firefox } = require("playwright");
const URL = `file://${W}/demo/index.html`;
const filter = process.argv[2] || "";
const useFirefox = process.env.FIREFOX === "1";
const browser = useFirefox ? await firefox.launch({ executablePath: "/home/yujiesim/.cache/ms-playwright/firefox-1573/firefox/firefox" }) : await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const problems = [];
async function open(w, h, hash, scale = 1) {
  const phone = w <= 620;
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, ...(useFirefox ? {} : { hasTouch: phone, isMobile: phone }) });
  await context.route("**/*", (route) => (route.request().url().startsWith("file://") && route.request().url().endsWith("/demo/index.html") ? route.continue() : (problems.push("REQUEST " + route.request().url().slice(0, 120)), route.abort())));
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push("PAGEERR " + String(e).slice(0, 300)));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push("CONSOLE " + m.text().slice(0, 300)); });
  page.on("requestfailed", (r) => problems.push("FAILED " + r.url().slice(0, 120)));
  await page.goto(`${URL}#${hash}`);
  await page.waitForTimeout(700);
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: `${W}/demo/${useFirefox ? "shots-ff" : "shots"}/${name}.png` });
const F = (sel) => `#frame ${sel}`;

// 1. Bare 1:1 frames in the prototype's own picture states, to put beside shots/hcc/r2-*.
const STATES = { "d-l2": "opt=d&level=2", "d-l2-mix": "opt=d&level=2&state=busy,mix", "d-l3": "opt=d&level=3", "d-l3-remote": "opt=d&level=3&state=busy,remote", "d-l3-yards": "opt=d&level=3&state=busy,yards",
  "e-l2": "opt=e&level=2", "e-l2-mix": "opt=e&level=2&state=busy,mix", "e-l2-inspect": "opt=e&level=2&state=busy,inspect", "e-l3": "opt=e&level=3", "e-l3-remote": "opt=e&level=3&state=busy,remote", "e-l3-yards": "opt=e&level=3&state=busy,yards" };
for (const [frame, w, h, scale] of [["phone", 390, 844, 3], ["desktop", 1280, 720, 1]]) {
  for (const [name, hash] of Object.entries(STATES)) {
    const tag = `match-${name}-${w}x${h}`;
    if (filter && !tag.includes(filter)) continue;
    const full = hash.includes("state=") ? hash : hash + "&state=busy";
    const { context, page } = await open(w, h, `${full}&frame=${frame}&bare=1&paused=1`, scale);
    await shot(page, tag);
    await context.close();
  }
}

// 2. The flows, clicked through on the full page.
async function flows(opt, level, frame, w, h) {
  const tag = `flow-${opt}-l${level}-${frame}`;
  if (filter && !tag.includes(filter)) return;
  const { context, page } = await open(w, h, "", 1);
  const click = async (sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(250); };
  const text = (sel) => page.locator(sel).first().textContent();
  const check = (ok, what) => { if (!ok) problems.push(`CHECK ${tag}: ${what}`); };
  await click(`#demo [data-set="opt=${opt}"]`); await click(`#demo [data-set="level=${level}"]`); await click(`#demo [data-set="frame=${frame}"]`);
  await shot(page, `${tag}-1-start`);
  const stacks = () => page.locator(F(".hatch-slot:not(.hatch-slot--empty)")).count();
  const before = await stacks();
  // add: Bandito is not the last stack's monster, so a new stack appears
  await click(F('.hatch-monster[data-monster="C6"]')); await click(F(".hatch-add__jump >> nth=1")); await click(F(".hatch-add__step--plus"));
  check((await page.locator(F(".hatch-add__count")).inputValue()) === "11", "count is 11");
  await shot(page, `${tag}-2-picked`);
  await click(F(".hatch-add__add"));
  if (opt === "e") { check((await text(F(".b9r2h-seal__part--queue .b9r2h-seal__number"))) === `${before + 1}/10`, "seal counts the new stack"); await shot(page, `${tag}-3-added-seal`); await click(F(".b9r2h-seal")); await page.waitForTimeout(200); }
  check((await stacks()) === before + 1, `a stack was added (${before} -> ${await stacks()})`);
  await shot(page, `${tag}-3-added`);
  if (opt === "e") await click(F(".b9r2h-back"));
  // save to the empty slot 5
  await click(F('.b9r2h-mix--empty[data-mix="4"]'));
  check((await page.locator(F('.b9r2h-mix[data-mix="4"]:not(.b9r2h-mix--empty)')).count()) === 1, "mix 5 saved");
  await shot(page, `${tag}-4-saved`);
  // clear
  if (opt === "e") await click(F(".b9r2h-seal"));
  await click(F(".hatch-clear"));
  check((await stacks()) === 0, "queue cleared");
  await shot(page, `${tag}-5-cleared`);
  if (opt === "e") await click(F(".b9r2h-back"));
  // load mix 5
  await click(F('.b9r2h-mix[data-mix="4"]'));
  check(await page.locator(F(".b9r2h-mixcard")).isVisible(), "mix card opens");
  await shot(page, `${tag}-6-mixcard`);
  await click(F(".b9r2h-mixcard__load"));
  if (opt === "e") await click(F(".b9r2h-seal"));
  check((await stacks()) >= before, `mix loaded (${await stacks()} stacks)`);
  await shot(page, `${tag}-7-loaded`);
  if (opt === "e") await click(F(".b9r2h-back"));
  // max, then the housing box
  await click(F(".hatch-add__fill")); await shot(page, `${tag}-8-max`);
  if (level === 3) {
    if (opt === "d") { await click(F('.b9r2h-stepper__arrow[data-by="1"]')); check((await text(F(".b9r2h-where__count"))) === "2/11", "stepped to yard 2"); await shot(page, `${tag}-9-outpost`); await click(F(".b9r2h-stepper__where")); }
    else await click(F(".b9r2h-yard--chip"));
    check(await page.locator(F(".b9r2h-yards")).isVisible(), "yard page opens");
    await shot(page, `${tag}-10-yards`);
    await page.locator(F(".b9r2h-search__input")).fill("long"); await page.waitForTimeout(200);
    check((await page.locator(F(".b9r2h-yardcard")).count()) === 1, "search narrows the yards");
    await click(F(".b9r2h-yardcard"));
    check((await text(F(".b9r2h-where__count"))) === "3/11", "picked yard 3");
    check((await page.locator(F(".hatch.b9r2h-remote")).count()) === 1, "remote frame on");
    await click(F('.hatch-monster[data-monster="C2"]')); await click(F(".hatch-add__jump >> nth=1")); await shot(page, `${tag}-11-outpost-add`);
    const was = await stacks(); await click(F(".hatch-add__add"));
    if (opt === "e") await click(F(".b9r2h-seal"));
    check((await stacks()) === was + 1 || opt === "e", "added at the outpost");
    await shot(page, `${tag}-12-outpost-added`);
    if (opt === "e") await click(F(".b9r2h-back"));
    await click(F(".b9r2h-yard--home"));
    check((await text(F(".b9r2h-where__count"))) === "1/11", "home again");
    await shot(page, `${tag}-13-home`);
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(!wide, "no sideways scroll");
  await context.close();
}
for (const opt of ["d", "e"]) for (const level of [2, 3]) { await flows(opt, level, "phone", 1280, 1000); await flows(opt, level, "desktop", 1440, 1000); }
// the page itself on a real phone width
if (!filter || "page-phone".includes(filter)) { const { context, page } = await open(390, 844, "", 2); await page.screenshot({ path: `${W}/demo/shots/page-phone-390.png`, fullPage: true }); const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (wide) problems.push("CHECK page-phone: sideways scroll"); await page.locator('#demo [data-set="frame=desktop"]').click(); await page.waitForTimeout(300); await page.screenshot({ path: `${W}/demo/shots/page-phone-390-desktopframe.png`, fullPage: true }); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) problems.push("CHECK page-phone desktop frame: sideways scroll"); await context.close(); }
await browser.close();
console.log(problems.length ? [...new Set(problems)].join("\n") : "no problems");
