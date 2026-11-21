import { launch, open, shot, crop } from "./lib.mjs";
const browser = await launch();
for (const look of ["modern", "classic"]) for (const [w, h] of [[1280, 720], [390, 844]]) {
  const tag = `${look}-${w}x${h}`;
  const { context, page } = await open(browser, { w, h, look });
  try {
    await shot(page, `current/yard-${tag}`);
    await page.getByRole("button", { name: /^Your yards/ }).first().click();
    await page.waitForTimeout(800);
    await shot(page, `current/switcher-${tag}`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Monsters/ }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, `current/hcc-${tag}`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    await page.evaluate(() => window.__yardSelect(592)); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Test attack" }).first().click(); await page.waitForTimeout(1500);
    await shot(page, `current/baiter-${tag}`);
    await page.getByRole("tab", { name: /Recent/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, `current/baiter-recent-${tag}`);
  } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `current/ERR-${tag}`); }
  await context.close();
}
await browser.close();
