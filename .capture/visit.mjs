import { launch, open, shot } from "./lib.mjs";
const browser = await launch();
for (const look of ["modern", "classic"]) for (const [w, h] of [[1280, 720], [390, 844], [844, 390]]) {
  const tag = `${look}-${w}x${h}`;
  const { context, page } = await open(browser, { w, h, look });
  try {
    await page.getByRole("button", { name: /^Friends/ }).first().click(); await page.waitForTimeout(1500);
    await page.getByText("agenttester").first().click(); await page.waitForTimeout(1200); await shot(page, `current/friendrow-${tag}`); await page.getByRole("button", { name: /Visit/ }).first().click(); await page.waitForTimeout(7000);
    await shot(page, `current/friendvisit-${tag}`);
  } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `current/ERR-visit-${tag}`); }
  await context.close();
}
await browser.close();
