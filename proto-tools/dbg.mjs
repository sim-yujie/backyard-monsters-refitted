import { openMap, demo, SHOTS } from "./lib.mjs";
const { browser, page } = await openMap({ skin: "modern", W: 1280, H: 720, query: `&live1=B` });
await demo(page, () => __liveDemo.storm({ count: 14, seconds: 0, seed: 3 }));
await page.waitForTimeout(200);
console.log(await demo(page, () => {
  const r = __bymrMr2TiltDebug.renderer;
  const g = r.pulses.graphics;
  const b = g.getLocalBounds();
  return JSON.stringify({ active: r.pulses.active, visible: g.visible, parent: !!g.parent, idx: g.parent?.children.indexOf(g), n: g.parent?.children.length, bounds: [b.x, b.y, b.width, b.height], ctx: g.context?.instructions?.length, stepped: r.paintedStepped, alpha: g.worldAlpha });
}));
await browser.close();
