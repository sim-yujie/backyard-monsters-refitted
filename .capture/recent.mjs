import { launch, open, shot } from "./lib.mjs";
const browser = await launch();
const look = process.argv[2] || "modern"; const [w,h] = (process.argv[3]||"1280x720").split("x").map(Number);
const tag = `${look}-${w}x${h}`;
const { context, page } = await open(browser, { w, h, look });
const baiter = async () => { await page.evaluate(() => window.__yardSelect(592)); await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Test attack" }).first().click(); await page.waitForTimeout(1500); };
try {
  await baiter();
  await page.getByRole("button", { name: "My army" }).click(); await page.waitForTimeout(300); await page.getByRole("button", { name: /^Fill/ }).nth(2).click(); await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Start test" }).click(); await page.waitForTimeout(20000);
  await shot(page, `current/baitertest-run-${tag}`);
  for (let i = 0; i < 20; i++) {
    const names = await page.getByRole("button").allInnerTexts();
    if (names.some((n) => /Back to yard|Done|Close|Change army/.test(n))) break;
    await page.waitForTimeout(8000);
  }
  await shot(page, `current/baitertest-report-${tag}`);
  console.log((await page.getByRole("button").allInnerTexts()).join("|").slice(0, 600));
} catch (e) { console.error(String(e).slice(0, 300)); await shot(page, `current/ERR-recent-${tag}`); }
await context.close(); await browser.close();
