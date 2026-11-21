import { launch, open } from "./lib.mjs";
const [w, h] = (process.argv[3] || "390x844").split("x").map(Number);
const browser = await launch();
const { context, page } = await open(browser, { w, h, look: "modern", query: process.argv[2] || "" });
await page.getByRole("button", { name: /^Monsters/ }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
console.log(await page.evaluate(() => {
  const strip = (n) => !n ? "NONE" : n.outerHTML.replace(/ (srcset|sizes|src|style|title|aria-[a-z]+|data-[a-z-]+|loading|decoding|draggable|alt|width|height)="[^"]*"/g, "");
  const out = [];
  const hcc = document.querySelector(".hatch-line--hcc");
  const now = hcc.querySelector(".hatch-now"); out.push(strip(now));
  const slot = hcc.querySelector(".hatch-slot"); out.push(strip(slot));
  out.push(strip(document.querySelector(".hatch-line__totals")));
  out.push(strip(document.querySelector(".hatch-message")).slice(0, 1500));
  const hdr = document.querySelector(".monsters-header"); out.push(strip(hdr));
  let p = document.querySelector(".hatch"); const chain = []; while (p && chain.length < 8) { const r = p.getBoundingClientRect(); chain.push(`${p.tagName}.${p.className} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`); p = p.parentElement; }
  out.push(chain.join("\n"));
  for (const sel of [".hatch__scroll", ".hatch-lines", ".hatch-line__now", ".hatch-line__slots", ".hatch-message", ".hatch-pick", ".hatch-info", ".hatch-add", ".hatch-add__add", ".hatch-monster"]) { const n = document.querySelector(sel); if (!n) { out.push(sel + " none"); continue; } const r = n.getBoundingClientRect(); out.push(`${sel} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
  out.push(strip(document.querySelector(".hatch-info")).slice(0, 2500));
  return out.join("\n----\n");
}));
await context.close(); await browser.close();
