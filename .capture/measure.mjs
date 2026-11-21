import { launch, open } from "./lib.mjs";
const [opt, look, size] = process.argv.slice(2); const [w, h] = size.split("x").map(Number);
const browser = await launch();
const { context, page } = await open(browser, { w, h, look, query: `&b9arrows=${opt}` });
const out = await page.evaluate(() => [...document.querySelectorAll(".yard-dock__button, .friend-hop")].map((e) => { const r = e.getBoundingClientRect(); return `${e.className.split(" ").slice(-1)} ${Math.round(r.x)}-${Math.round(r.right)} y${Math.round(r.y)}-${Math.round(r.bottom)}`; }));
console.log(out.join("\n"));
await context.close(); await browser.close();
