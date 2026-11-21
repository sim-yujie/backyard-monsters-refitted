// node arrows.mjs <opts d,e,f,f-open,now> <looks> <sizes> [main]   -> shots/arrows/r2-<opt>-<look>-<WxH>[-main].png
import { launch, open, shot } from "./lib.mjs";
const opts = (process.argv[2] || "d,e,f,f-open").split(",");
const looks = (process.argv[3] || "modern,classic").split(",");
const sizes = (process.argv[4] || "390x844,844x390,1280x720").split(",").map((s) => s.split("x").map(Number));
const wheres = (process.argv[5] || "outpost").split(",");
const browser = await launch();
for (const look of looks) for (const [w, h] of sizes) for (const opt of opts) for (const where of wheres) {
  const tag = `r2-${opt}-${look}-${w}x${h}${where === "main" ? "-main" : ""}`;
  const o = opt[0];
  const query = opt === "now" ? "" : `&b9arrows=${o}`;
  const { context, page } = await open(browser, { w, h, look, query });
  try {
    if (where !== "main") {
      const opener = opt === "now" ? ".yard-switcher__button" : o === "d" ? ".b9r2-wheredisc" : o === "e" ? ".b9r2-pill__where" : ".b9r2-tile";
      await page.locator(opener).first().click(); await page.waitForTimeout(500);
      if (o === "f") { await page.locator(".b9r2-travel__button[aria-label='All yards']").click(); await page.waitForTimeout(500); }
      await page.locator(".yard-switcher__rows").getByText("main outpost").first().click();
      await page.waitForTimeout(7000);
      for (const name of ["Close", "OK", "Not now", "Later"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
      if (o === "f" && opt !== "f-open") { await page.locator(".b9r2-travel__close").click().catch(() => {}); }
    } else if (opt === "f-open") { await page.locator(".b9r2-tile").click(); }
    await page.waitForTimeout(600);
    await shot(page, `arrows/${tag}`);
    if (process.env.MEASURE) console.log(tag, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".b9r2-arrow,.b9r2-pill__arrow,.b9r2-pill__where,.b9r2-tile,.b9r2-wheredisc,.b9r2-travel__button,.b9r2-travel__close")].map((n) => { const r = n.getBoundingClientRect(); return [n.className.split(" ").pop(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }))));
  } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `arrows/ERR-${tag}`); }
  await context.close();
}
await browser.close();
