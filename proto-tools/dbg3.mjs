import { openMap, demo, SHOTS } from "./lib.mjs";
const { browser, page } = await openMap({ skin: "modern", W: 1280, H: 720, query: `&live1=B` });
await demo(page, () => __bymrMr2Tilt("off"));
await page.waitForTimeout(1500);
await demo(page, () => { __liveDemo.storm({ count: 14, seconds: 0, seed: 3 }); __liveDemo.freeze(0.05); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/dbg-modern-flat.png` });
console.log(await demo(page, () => { const c = __bymrMr2TiltDebug.camera; const r = __bymrMr2TiltDebug.renderer; return JSON.stringify({ pos: c.position, zoom: c.zoom, kids: r.root.children.map((k) => k.constructor.name + ":" + k.visible + ":" + k.alpha) }); }));
await browser.close();
