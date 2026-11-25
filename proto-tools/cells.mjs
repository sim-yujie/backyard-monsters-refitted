import { openMap, demo } from "./lib.mjs";
const { browser, page } = await openMap({ skin: "modern", W: 1280, H: 720 });
console.log(await demo(page, () => JSON.stringify(__liveDemo.cells().filter((c) => c.kind !== "camp" || c.inRange).map((c) => `${c.col},${c.row}:${c.kind}${c.inRange ? "*" : ""}:${c.name}`))));
await browser.close();
