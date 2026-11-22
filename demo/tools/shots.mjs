// node shots.mjs [filter]  -> demo/shots/<name>.png. Opens demo/index.html from file:// with the network blocked, and clicks through it.
import { createRequire } from "node:module";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
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

// 1. Bare 1:1 frames in the prototype's own picture states, to put beside shots/hcc-r3/.
const STATES = { "l2-monsters": "level=2&state=busy", "l2-presets-empty": "level=2&state=busy,presets,empty,room", "l2-building": "level=2&state=busy,presets,empty,edit,room", "l3-presets": "level=3&state=busy,presets,filled",
  "l3-edit": "level=3&state=busy,presets,filled,edit", "l3-sent": "level=3&state=busy,presets,filled,sent,room", "l3-remote-presets": "level=3&state=busy,remote,presets,filled", "l3-yards": "level=3&state=busy,yards", "l2-housing": "level=2&state=busy,presets,filled,housing" };
for (const [frame, w, h, scale] of [["phone", 390, 844, 3], ["desktop", 1280, 720, 1]]) {
  for (const [name, hash] of Object.entries(STATES)) {
    const tag = `match-${name}-${w}x${h}`;
    if (filter && !tag.includes(filter)) continue;
    const { context, page } = await open(w, h, `${hash}&frame=${frame}&bare=1&paused=1`, scale);
    await shot(page, tag);
    await context.close();
  }
}

// 2. The "Try this" flow, clicked through on the full page.
async function flow(level, frame, w, h) {
  const tag = `flow-l${level}-${frame}`;
  if (filter && !tag.includes(filter)) return;
  const { context, page } = await open(w, h, "", 1);
  const click = async (sel) => { try { await page.locator(sel).first().click({ timeout: 3000 }); } catch { problems.push(`NOCLICK ${tag}: ${sel}`); } await page.waitForTimeout(200); };
  const text = (sel) => page.locator(sel).first().textContent();
  const count = (sel) => page.locator(F(sel)).count();
  const check = (ok, what) => { if (!ok) problems.push(`CHECK ${tag}: ${what}`); };
  await click(`#demo [data-set="level=${level}"]`); await click(`#demo [data-set="frame=${frame}"]`);
  check((await page.locator("#demo [data-set^='opt=']").count()) === 0, "no D/E toggle");
  await shot(page, `${tag}-1-start`);
  const stacks = () => count(".hatch-slot:not(.hatch-slot--empty)");
  const queued = async () => (await page.locator(F(".hatch-slot__count")).allTextContents()).reduce((sum, t) => sum + Number(t.replace(/\D/g, "")), 0);
  // Monsters tab still adds
  const before = await stacks();
  await click(F('.hatch-monster[data-monster="C6"]')); await click(F(".hatch-info > .hatch-add:not(.b9r3h-set) .hatch-add__jump >> nth=1")); await click(F(".hatch-add__add"));
  check((await stacks()) === before + 1, `Monsters tab: a stack was added (${before} -> ${await stacks()})`);
  // Presets tab
  await click(F('.b9r3h-tab[data-tab="presets"]'));
  check((await count(".b9r3h-row")) === (level === 3 ? 5 : 3), `${level === 3 ? 5 : 3} preset slots`);
  check(!(await page.locator(F(".hatch__split")).isVisible()), "the monsters are hidden on the Presets tab");
  await shot(page, `${tag}-2-presets`);
  // build preset 2
  await click(F('.b9r3h-row--empty [data-preset="1"]'));
  check(await page.locator(F(".b9r3h-edit")).isVisible(), "the preset's head shows");
  check(!(await page.locator(F(".b9r3h-switch")).isVisible().catch(() => false)), "the switch gives way to the head");
  await click(F('.hatch-monster[data-monster="C8"]')); await click(F(".b9r3h-set .hatch-add__jump >> nth=1")); await click(F(".b9r3h-set .hatch-add__jump >> nth=1"));
  await click(F('.hatch-monster[data-monster="C2"]')); await click(F(".b9r3h-set .hatch-add__fill"));
  await click(F(".b9r3h-set .hatch-add__step--minus"));
  check((await count(".b9r3h-chip")) === 2, "two monsters in the preset");
  check((await page.locator(F(".b9r3h-count")).inputValue()) === String((level === 3 ? 30 : 20) - 1), "count is one stack less one");
  check((await count(".b9r3h-inpreset")) === 2, "the grid wears the counts");
  await shot(page, `${tag}-3-building`);
  await page.locator(F(".b9r3h-count")).fill("12"); await page.waitForTimeout(200);
  await click(F(".b9r3h-edit__done"));
  check((await count(".b9r3h-row:not(.b9r3h-row--empty)")) === 2, "preset 2 is made");
  await shot(page, `${tag}-4-made`);
  // send it: all of it fits
  const q0 = await queued();
  await click(F('.b9r3h-send[data-preset="1"]'));
  check((await queued()) === q0 + 32, `Send added 32 (${q0} -> ${await queued()})`);
  check(/^Added 32$/.test((await text(F(".b9r3h-said strong"))) || ""), "the row says Added 32");
  await shot(page, `${tag}-5-sent`);
  // keep sending preset 1 until the queue is full
  let said = "";
  for (let i = 0; i < 12; i += 1) { await click(F('.b9r3h-send[data-preset="0"]')); said = (await text(F(".b9r3h-said"))) || ""; if (/Added \d+ of/.test(said)) break; }
  check(/Added \d+ of 100/.test(said) && /queue is full/.test(said), `the row says how many fitted (${said})`);
  check((await stacks()) === 10, "the queue is full");
  await shot(page, `${tag}-6-sent-part`);
  // change preset 1, empty it, undo by Start over later
  await click(F('.b9r3h-row__body[data-preset="0"]'));
  check((await count(".b9r3h-chip:not(.b9r3h-chip--next)")) === 3, "preset 1 opens with its three stacks, in order");
  await click(F(".b9r3h-chip--last"));
  check((await page.locator(F(".b9r3h-count")).inputValue()) === "30", "the last stack's chip chooses its monster and shows its count");
  await click(F(".b9r3h-edit__bin"));
  check((await count(".b9r3h-chip")) === 0, "Clear empties the preset");
  await click(F(".b9r3h-edit__done"));
  check((await count(".b9r3h-row--empty")) === (level === 3 ? 4 : 2), "the emptied slot is a + again");
  // the housing box
  await click(F(".b9r2h-housing")); check(await page.locator(F(".hatch-message")).isVisible(), "the housing box opens"); await shot(page, `${tag}-7-housing`); await click(F(".b9r2h-housing"));
  if (level === 3) {
    await click(F('.b9r2h-stepper__arrow[data-by="1"]'));
    check((await text(F(".b9r2h-where__count"))) === "2/11", "stepped to yard 2");
    check((await count(".hatch.b9r2h-remote")) === 1, "remote frame on");
    check((await page.locator(F(".b9r3h-presets")).getAttribute("data-scope")) === "outposts", "the outposts' list shows");
    check((await count(".b9r3h-tab .game-icon--outpost")) === 1, "the Presets tab wears the flag");
    await shot(page, `${tag}-8-outpost`);
    const o0 = await queued(); await click(F('.b9r3h-send[data-preset="0"]'));
    check((await queued()) > o0, "Send at the outpost");
    await shot(page, `${tag}-9-outpost-sent`);
    await click(F('.b9r2h-stepper__arrow[data-by="1"]'));
    check((await count(".b9r3h-row:not(.b9r3h-row--empty)")) === 1, "outpost 3 shares the outposts' list");
    await click(F(".b9r2h-stepper__where"));
    check(await page.locator(F(".b9r2h-yards")).isVisible(), "yard page opens");
    await shot(page, `${tag}-10-yards`);
    await click(F(".b9r2h-yardcard >> nth=0"));
    check((await text(F(".b9r2h-where__count"))) === "1/11", "home again");
    check((await page.locator(F(".b9r3h-presets")).getAttribute("data-scope")) === "main", "the main yard's list is back");
  }
  await click("#demo [data-reset]");
  check((await count(".b9r3h-tab--on[data-tab='monsters']")) === 1, "Start over returns to Monsters");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll");
  await context.close();
}
for (const level of [2, 3]) { await flow(level, "phone", 1280, 1000); await flow(level, "desktop", 1440, 1000); }
// 3. The page itself on a real phone width, and a light-theme host page.
if (!filter || "page".includes(filter)) {
  const { context, page } = await open(390, 844, "", 2);
  await page.screenshot({ path: `${W}/demo/shots/page-phone-390.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) problems.push("CHECK page-phone: sideways scroll");
  await context.close();
  const d = await open(1440, 1000, "level=3&frame=desktop", 1);
  await d.page.screenshot({ path: `${W}/demo/shots/page-desktop-1440.png` });
  await d.context.close();
}
await browser.close();
console.log(problems.length ? [...new Set(problems)].join("\n") : "no problems");
