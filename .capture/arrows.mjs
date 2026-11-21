import { launch, open, shot, crop } from "./lib.mjs";
const opts = (process.argv[2] || "a,b,c").split(",");
const looks = (process.argv[3] || "modern,classic").split(",");
const sizes = (process.argv[4] || "1280x720,390x844,844x390").split(",").map((s) => s.split("x").map(Number));
const onMain = process.argv[5] === "main";
const browser = await launch();
for (const opt of opts) for (const look of looks) for (const [w, h] of sizes) {
  const tag = `${opt}-${look}-${w}x${h}${onMain ? "-mainyard" : ""}`;
  const { context, page } = await open(browser, { w, h, look, query: `&b9arrows=${opt}` });
  try {
    const flag = page.locator(".yard-switcher__button").first();
    if (!onMain) {
    await flag.click(); await page.waitForTimeout(500);
    if (opt === "c") { await page.locator(".b9-tray__all").click(); await page.waitForTimeout(500); }
    await page.locator(".yard-switcher__rows").getByText("main outpost").first().click();
    await page.waitForTimeout(7000);
    }
    await page.keyboard.press("Escape").catch(() => {});
    for (const name of ["Close", "OK", "Not now", "Later"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
    await page.waitForTimeout(500);
    if (opt === "c") { await flag.click(); await page.waitForTimeout(600); }
    await shot(page, `arrows/${tag}`);
    // bottom-left crop at device scale
    const vp = page.viewportSize();
    const cw = Math.min(vp.width, w < 500 ? vp.width : 460), ch = Math.min(vp.height, w < 500 ? 420 : 360);
    await page.screenshot({ path: `/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/b9-screens/shots/arrows/${tag}-crop.png`, clip: { x: 0, y: vp.height - ch, width: cw, height: ch }, scale: "device" });
  } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `arrows/ERR-${tag}`); }
  await context.close();
}
await browser.close();
