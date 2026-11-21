// node hcc.mjs "<job,job>" looks sizes   -> shots/hcc/r2-<job>-<look>-<WxH>.png
import { launch, open, shot, BASE } from "./lib.mjs";
const ALL = {
  "now": "",
  "d-l2": "b9hcc=2&b9hccopt=d",
  "d-l2-mix": "b9hcc=2&b9hccopt=d&b9state=mix",
  "d-l3": "b9hcc=3&b9hccopt=d",
  "d-l3-remote": "b9hcc=3&b9hccopt=d&b9state=remote",
  "d-l3-yards": "b9hcc=3&b9hccopt=d&b9state=yards",
  "e-l2": "b9hcc=2&b9hccopt=e",
  "e-l2-mix": "b9hcc=2&b9hccopt=e&b9state=mix",
  "e-l2-inspect": "b9hcc=2&b9hccopt=e&b9state=inspect",
  "e-l3": "b9hcc=3&b9hccopt=e",
  "e-l3-remote": "b9hcc=3&b9hccopt=e&b9state=remote",
  "e-l3-yards": "b9hcc=3&b9hccopt=e&b9state=yards",
};
const jobs = (process.argv[2] || Object.keys(ALL).join(",")).split(",");
const looks = (process.argv[3] || "modern,classic").split(",");
const sizes = (process.argv[4] || "390x844,1280x720").split(",").map((s) => s.split("x").map(Number));
const browser = await launch();
for (const look of looks) for (const [w, h] of sizes) {
  const { context, page } = await open(browser, { w, h, look });
  for (const job of jobs) {
    const tag = `r2-${job}-${look}-${w}x${h}`;
    try {
      await page.goto(`${BASE}/?skin=auto&${ALL[job]}`);
      await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
      await page.waitForTimeout(3000);
      await page.keyboard.press("Escape").catch(() => {});
      await page.getByRole("button", { name: /^Monsters/ }).first().click();
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
      await page.waitForTimeout(1800);
      await shot(page, `hcc/${tag}`);
      if (process.env.MEASURE) console.log(tag, JSON.stringify(await page.evaluate(() => {
        const vp = [innerWidth, innerHeight]; const bad = [];
        for (const n of document.querySelectorAll(".hatch button, .hatch input")) { const r = n.getBoundingClientRect(); if (!r.width || n.closest("[hidden]")) continue; if (r.width < 43.5 || r.height < 43.5) bad.push([String(n.className).split(" ").slice(0, 2).join("."), Math.round(r.width), Math.round(r.height)]); }
        const add = document.querySelector(".hatch-add__add")?.getBoundingClientRect(); const grid = document.querySelector(".hatch-monster")?.getBoundingClientRect();
        return { vp, addBottom: add && Math.round(add.bottom), gridTop: grid && Math.round(grid.top), gridBottom: grid && Math.round(grid.bottom), small: bad.slice(0, 12) };
      })));
    } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `hcc/ERR-${tag}`); }
  }
  await context.close();
}
await browser.close();
