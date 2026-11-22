// node check-r6.mjs -> clicks through demo/index.html (file://, network blocked) at L1, L2 and L3, phone and desktop:
// 2/4/6 preset slots, 7/10/10 queue boxes (level 1 shows 3 more locked), no "+N", the long row scrolls sideways with
// Send and the cost fixed, a preset is built in boxes. Round 6: no quick-send rail; the yard switcher, the hatchery
// row, the queue and the tab switch stand in the SAME place at every level and in an outpost.
import { createRequire } from "node:module";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const problems = [];
const PLACES = {};
const SLOTS = { 1: 2, 2: 4, 3: 6 }, BOXES = { 1: 7, 2: 10, 3: 10 }, SIZE = { 1: 20, 2: 20, 3: 30 };
try {
  for (const frame of ["phone", "desktop"]) for (const level of [1, 2, 3]) {
    const tag = `l${level}-${frame}`;
    const phone = frame === "phone";
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 1500 } : { width: 1440, height: 1300 }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
    await context.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : (problems.push("REQUEST " + route.request().url().slice(0, 100)), route.abort())));
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`PAGEERR ${tag} ${String(e).slice(0, 300)}`));
    await page.goto(`file://${W}/demo/index.html#paused=1`);
    await page.waitForTimeout(700);
    const F = (sel) => `#frame ${sel}`;
    const click = async (sel) => { try { await page.locator(sel).first().click({ timeout: 3000 }); } catch { problems.push(`NOCLICK ${tag}: ${sel}`); } await page.waitForTimeout(150); };
    const check = (ok, what) => { console.log(ok ? "  ok " : "  BAD", tag, what); if (!ok) problems.push(`CHECK ${tag}: ${what}`); };
    const shot = (name) => page.locator("#frame").screenshot({ path: `${W}/demo/shots/r6/${tag}-${name}.png` });
    const count = (sel) => page.locator(F(sel)).count();
    const visible = (sel) => page.locator(F(sel)).first().isVisible();
    const rect = (sel) => page.locator(F(sel)).first().evaluate((n) => { const b = n.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(","); });
    await click(`#demo .demo-seg [data-set="level=${level}"]`); await click(`#demo [data-set="frame=${frame}"]`);
    check((await page.locator("#demo .demo-level").count()) === 3 && (await page.locator(`#demo .demo-level[aria-pressed="true"] strong`).textContent()) === `Level ${level}`, "the page shows the three level cards, this level marked");
    check((await count(".hatch-line__slots .hatch-slot")) === BOXES[level], `the queue has ${BOXES[level]} boxes (${await count(".hatch-line__slots .hatch-slot")})`);
    await shot("1-hatch");
    check((await count(".b9r5h-rail")) === 0, "no quick-send rail");
    check((await count(".b9r6h-box--locked")) === 10 - BOXES[level], `${10 - BOXES[level]} locked boxes after the queue's own`);
    check((await count(".b9r2h-stepper")) === 1 && (await count(".b9r2h-yard")) === 0, "one yard switcher, no other yard button");
    check((await page.locator(F(".b9r2h-stepper__where")).isDisabled()) === (level < 3), `the switcher is ${level < 3 ? "greyed (locked)" : "live"}`);
    const where = async () => { const out = {}; for (const sel of [".b9r2h-stepper", ".b9r2h-housing__bar", ".hatch-line__now", ".hatch-line__slots", ".b9r3h-switch", '.b9r3h-tab[data-tab="presets"] span']) out[sel] = await page.locator(F(sel)).first().evaluate((n) => { const f = document.querySelector("#frame .hatch").getBoundingClientRect(), b = n.getBoundingClientRect(); return [b.x - f.x, b.y - f.y, b.width, b.height].map(Math.round).join(","); }); return out; };
    const same = (a, b, what) => { const moved = Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]} -> ${b[k]}`); check(moved.length === 0, `${what}: nothing moved${moved.length ? " (" + moved.join("; ") + ")" : ""}`); };
    const here = await where();
    if (PLACES[frame]) same(PLACES[frame], here, `level ${level} vs level 1`); else PLACES[frame] = here;
    if (!phone) {
      const bench = await page.locator(F(".b9r2h-bench")).boundingBox(), slots = await page.locator(F(".hatch-line__slots")).boundingBox(), now = await page.locator(F(".hatch-line__now")).boundingBox();
      check(slots.x + slots.width >= bench.x + bench.width - 4 && now.width > 400 && slots.width > 450, `desktop: hatcheries and queue fill the row (${Math.round(now.width)} + ${Math.round(slots.width)} of ${Math.round(bench.width)})`);
    }
    if (level === 3) {
      await click(F('.b9r2h-stepper__arrow[data-by="1"]'));
      check((await count(".b9r2h-remote")) === 1, "stepped to an outpost");
      same(here, await where(), "level 3 outpost vs main yard");
      await shot("1b-outpost");
      await click(F('.b9r2h-stepper__arrow[data-by="-1"]'));
    }
    await click(F('.b9r3h-tab[data-tab="presets"]'));
    check((await count(".b9r3h-row")) === SLOTS[level], `level ${level} has ${SLOTS[level]} preset slots (${await count(".b9r3h-row")})`);
    check((await count(".b9r3h-stacks__more")) === 0 && !(await page.locator(F(".b9r3h-presets")).textContent()).includes("+1"), 'no "+N" anywhere');
    await shot("3-presets");
    if (level >= 2) {
      const strip = page.locator(F(".b9r3h-row:nth-child(3) .b9r3h-row__stacks"));
      const m = await strip.evaluate((n) => ({ c: n.clientWidth, s: n.scrollWidth, n: n.children.length, right: n.classList.contains("b9r5h-more-right") }));
      check(m.n === 8, `preset 3 lists all eight stacks (${m.n})`);
      if (phone) {
        check(m.s > m.c && m.right, `phone: preset 3's stacks overflow and fade on the right (${m.c}/${m.s})`);
        const send = await rect(".b9r3h-row:nth-child(3) .b9r3h-send"), cost = await rect(".b9r3h-row:nth-child(3) .b9r3h-row__cost");
        await strip.evaluate((n) => { n.scrollLeft = n.scrollWidth; }); await page.waitForTimeout(250);
        const end = await strip.evaluate((n) => { const a = n.getBoundingClientRect(), b = n.lastElementChild.getBoundingClientRect(); return { seen: b.right <= a.right + 1 && b.left >= a.left - 1, left: n.classList.contains("b9r5h-more-left"), right: n.classList.contains("b9r5h-more-right") }; });
        check(end.seen && end.left && !end.right, "scrolled to the end: the last stack is in view, the fade moved to the left");
        check(send === (await rect(".b9r3h-row:nth-child(3) .b9r3h-send")) && cost === (await rect(".b9r3h-row:nth-child(3) .b9r3h-row__cost")), "Send and the cost did not move");
        await shot("4-long-scrolled");
      }
    }
    // Build a preset in the empty slot.
    const tall = await page.locator(F(".hatch")).first().evaluate((n) => Math.round(n.getBoundingClientRect().height));
    await click(F(".b9r3h-row--empty .b9r3h-row__body"));
    check(!(await visible(".b9r2h-bench")), "building: the hatcheries and the queue are hidden");
    check((await count(".b9r5h-boxes > *")) === BOXES[level] && (await count(".b9r5h-boxes > .hatch-slot--empty")) === BOXES[level], `building: ${BOXES[level]} empty boxes`);
    const size = SIZE[level];
    const add = async (id, n) => { await click(F(`.hatch-monster[data-monster="${id}"]`)); await page.locator(F(".b9r3h-count")).fill(String(n)); await page.locator(F(".b9r3h-count")).dispatchEvent("change"); await page.waitForTimeout(150); };
    await add("C1", size);
    await click(F('.hatch-monster[data-monster="C2"]'));
    check((await count(".b9r5h-box--next")) === 1, "another monster chosen: the next box shows it faint");
    await add("C2", size + 10); // two boxes
    await add("C1", size);
    const boxes = () => page.locator(F(".b9r5h-boxes > *")).evaluateAll((ns) => ns.map((n) => (n.classList.contains("hatch-slot--empty") ? "_" : n.textContent.replace("✎", "*"))).join(" "));
    const want = [`×${size}`, `×${size}`, "×10", `×${size}*`, ...Array(BOXES[level] - 4).fill("_")].join(" ");
    check((await boxes()) === want, `the boxes are the queue stacks, in order (${await boxes()})`);
    check((await page.locator(F(".b9r3h-edit__stacks")).textContent()) === `${BOXES[level] - 4} left`, `it says ${BOXES[level] - 4} left (${await page.locator(F(".b9r3h-edit__stacks")).textContent()})`);
    await shot("5-building");
    await click(F(".b9r3h-edit__undo")); await click(F(".b9r3h-edit__undo"));
    check((await boxes()).startsWith(`×${size} ×${size} + _`), `Undo twice took two boxes off, the second from the two-box stack; Pokey would start the next box (${await boxes()})`);
    await add("C1", size);
    await click(F(".b9r3h-edit__done"));
    check(await visible(".b9r2h-bench"), "Done: the hatcheries and the queue are back");
    const now = await page.locator(F(".hatch")).first().evaluate((n) => Math.round(n.getBoundingClientRect().height));
    check(Math.abs(now - tall) <= 2, `Done: same height (${tall} -> ${now}; a Send note under a row is 2 px)`);
    check((await count(".b9r3h-row--empty")) === 0, "the new preset has its row");
    await click(F(`.b9r3h-row:nth-child(${SLOTS[level]}) .b9r3h-send`));
    check(/^Added \d+/.test(await page.locator(F(".b9r3h-row .b9r3h-said")).first().textContent().catch(() => "")), `Send says what it did (${await page.locator(F(".b9r3h-row .b9r3h-said")).first().textContent().catch(() => "")})`);
    await shot("6-sent");
    if (level === 3) {
      await click(F('.b9r2h-stepper__arrow[data-by="1"]'));
      await click(F('.b9r3h-tab[data-tab="presets"]'));
      check((await count(".b9r3h-row")) === 6 && (await page.locator(F(".b9r3h-presets")).getAttribute("data-scope")) === "outposts", "an outpost: the shared outpost list, six slots");
      await shot("7-outpost");
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log(problems.length ? "PROBLEMS\n" + problems.join("\n") : "NO PROBLEMS");
