// node check-r4.mjs -> clicks through demo/index.html (file://, network blocked): builds the sequence
// Pokey 30 > Octo-ooze 40 > Pokey 30 in an empty slot, checks the order, the hidden progress, Undo, Done and Send.
import { createRequire } from "node:module";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });
const problems = [];
try {
  for (const [frame, w, h, scale, level] of [["phone", 390, 844, 2, 3], ["desktop", 1440, 900, 1, 3], ["phone", 390, 844, 2, 2]]) {
    const tag = `l${level}-${frame}`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: frame === "phone", isMobile: frame === "phone" });
    await context.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : (problems.push("REQUEST " + route.request().url().slice(0, 100)), route.abort())));
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`PAGEERR ${tag} ${String(e).slice(0, 300)}`));
    await page.goto(`file://${W}/demo/index.html#paused=1`);
    await page.waitForTimeout(700);
    const F = (sel) => `#frame ${sel}`;
    const click = async (sel) => { try { await page.locator(sel).first().click({ timeout: 3000 }); } catch { problems.push(`NOCLICK ${tag}: ${sel}`); } await page.waitForTimeout(150); };
    const check = (ok, what) => { console.log(ok ? "  ok " : "  BAD", tag, what); if (!ok) problems.push(`CHECK ${tag}: ${what}`); };
    const shot = (name) => page.screenshot({ path: `${W}/demo/shots/r4/${tag}-${name}.png` });
    const seq = (sel) => page.locator(F(sel)).evaluateAll((ns) => ns.filter((n) => n.getBoundingClientRect().width > 0).map((n) => `${(n.querySelector("img")?.getAttribute("src") ? "" : "")}${n.getAttribute("aria-label")?.match(/: ([^,]+),/)?.[1] ?? ""}${n.textContent.trim()}`).join(" > "));
    const queue = () => page.locator(F(".hatch-slot:not(.hatch-slot--empty)")).evaluateAll((ns) => ns.map((n) => `${n.getAttribute("aria-label") || n.title || ""}|${n.textContent.trim()}`));
    const visible = (sel) => page.locator(F(sel)).first().isVisible();
    const height = () => page.locator(F(".hatch")).first().evaluate((n) => Math.round(n.getBoundingClientRect().height));
    await click(`#demo [data-set="level=${level}"]`); await click(`#demo [data-set="frame=${frame}"]`);
    const size = level === 3 ? 30 : 20;
    await click(F('.b9r3h-tab[data-tab="presets"]'));
    const first = await page.locator(F(".b9r3h-row")).first().evaluate((row) => [...row.querySelectorAll(".b9r3h-stack")].map((n) => n.textContent.trim()).join(" > "));
    check(first === "×30 > ×40 > ×30", `the ready-made preset 1 is a sequence of three stacks (${first})`);
    const tall = await height();
    await shot("1-presets");
    await click(F(".b9r3h-row--empty .b9r3h-row__body"));
    check(!(await visible(".b9r2h-bench")), "building: the hatcheries and the queue are hidden");
    check(!(await visible(".b9r2h-strip")), "building: the yard and housing strip is hidden");
    check((await page.locator(F(".b9r3h-warn")).count()) === 0 || !(await visible(".b9r3h-warn")), "building: the housing warning is hidden");
    check((await height()) === tall, `building: the tab keeps its height (${tall} -> ${await height()})`);
    const add = async (id, n) => { await click(F(`.hatch-monster[data-monster="${id}"]`)); await page.locator(F(".b9r3h-count")).fill(String(n)); await page.locator(F(".b9r3h-count")).dispatchEvent("change"); await page.waitForTimeout(150); };
    await add("C1", 30);
    await click(F('.hatch-monster[data-monster="C2"]'));
    check(await visible(".b9r3h-chip--next"), "another monster chosen: the next stack shows faint at the end");
    await add("C2", 30);
    await click(F(".b9r3h-set .hatch-add__jump >> nth=1")); // +10 on the last stack
    await add("C1", 30);
    const chips = () => page.locator(F(".b9r3h-edit__chips .b9r3h-chip:not(.b9r3h-chip--next)")).evaluateAll((ns) => ns.map((n) => `${n.getAttribute("aria-label").match(/: ([^,]+),/)[1]}${n.textContent.trim().replace("✎", "")}`).join(" > "));
    check((await chips()) === "Pokey×30 > Octo-ooze×40 > Pokey×30", `the stacks keep the order they were added in (${await chips()})`);
    check((await page.locator(F('.hatch-monster[data-monster="C1"] .b9r3h-inpreset')).textContent()) === "Σ 60", "Pokey's card says Σ 60 over both its stacks");
    await shot("2-building");
    await click(F(".b9r3h-edit__undo"));
    check((await chips()) === "Pokey×30 > Octo-ooze×40", `Undo takes the last stack off (${await chips()})`);
    await add("C1", 30);
    await click(F(".b9r3h-edit__done"));
    check(await visible(".b9r2h-bench"), "Done: the hatcheries and the queue are back");
    check((await height()) === tall, `Done: same height (${await height()})`);
    const row = await page.locator(F(".b9r3h-row")).nth(1).evaluate((n) => [...n.querySelectorAll(".b9r3h-stack")].map((s) => s.textContent.trim()).join(" > "));
    check(row === "×30 > ×40 > ×30", `the new preset's row lists three stacks in order (${row})`);
    await shot("3-done");
    const before = await queue();
    await click(F(`.b9r3h-row:nth-child(2) .b9r3h-send`));
    const said = await page.locator(F(".b9r3h-said")).first().textContent();
    const after = await queue();
    console.log("  queue before:", before.join(" , "));
    console.log("  queue after :", after.join(" , "), "| said:", said);
    await shot("4-sent");
    await context.close();
  }
} finally { await browser.close(); }
console.log(problems.length ? "PROBLEMS\n" + problems.join("\n") : "NO PROBLEMS");
