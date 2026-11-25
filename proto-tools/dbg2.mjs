import { openMap, demo, SHOTS } from "./lib.mjs";
const [skin] = process.argv.slice(2);
const { browser, page } = await openMap({ skin, W: 1280, H: 720, query: `&live1=B` });
await demo(page, () => { __liveDemo.storm({ count: 14, seconds: 0, seed: 3 }); __liveDemo.freeze(0.05); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/dbg-${skin}.png` });
await browser.close();
