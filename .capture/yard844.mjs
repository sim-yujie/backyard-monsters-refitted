import { launch, open, shot } from "./lib.mjs";
const browser = await launch();
for (const look of ["modern", "classic"]) { const { context, page } = await open(browser, { w: 844, h: 390, look }); await shot(page, `current/yard-${look}-844x390`); await context.close(); }
await browser.close();
