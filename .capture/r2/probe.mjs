import { launch, open, shot } from "./lib.mjs";
const browser = await launch();
const { context, page } = await open(browser, { w: 390, h: 844, look: "modern", query: process.argv[2] || "" });
await shot(page, "r2/probe-yard");
await page.getByRole("button", { name: /^Monsters/ }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
await shot(page, "r2/probe-hatch");
await context.close(); await browser.close();
