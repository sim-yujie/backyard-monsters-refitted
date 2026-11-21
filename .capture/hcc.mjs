import { launch, open, shot, crop } from "./lib.mjs";
// node hcc.mjs "<job,job>" looks sizes ; job = name=query
const ALL = {
  "a-l2": "b9hcc=2&b9hccopt=a",
  "a-l2-mixes": "b9hcc=2&b9hccopt=a&b9state=mixes",
  "a-l3-picker": "b9hcc=3&b9hccopt=a&b9state=picker",
  "a-l3-remote": "b9hcc=3&b9hccopt=a&b9state=remote",
  "b-l2": "b9hcc=2&b9hccopt=b",
  "b-l3-picker": "b9hcc=3&b9hccopt=b&b9state=picker",
  "b-l3-remote": "b9hcc=3&b9hccopt=b&b9state=remote",
  "b-l3-build": "b9hcc=3&b9hccopt=b&b9state=build",
  "c-l3-remote": "b9hcc=3&b9hccopt=c&b9state=remote",
  "c-l3-rail": "b9hcc=3&b9hccopt=c&b9state=rail",
};
const jobs = (process.argv[2] || Object.keys(ALL).join(",")).split(",");
const looks = (process.argv[3] || "modern,classic").split(",");
const sizes = (process.argv[4] || "1280x720,390x844").split(",").map((s) => s.split("x").map(Number));
const browser = await launch();
for (const look of looks) for (const [w, h] of sizes) {
  // one login per look/size; reload with new params for each job
  const { context, page } = await open(browser, { w, h, look });
  for (const job of jobs) {
    const tag = `${job}-${look}-${w}x${h}`;
    try {
      await page.goto(`http://localhost:5401/?skin=auto&${ALL[job]}`);
      await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
      await page.waitForTimeout(3000);
      await page.keyboard.press("Escape").catch(() => {});
      await page.getByRole("button", { name: /^Monsters/ }).first().click();
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: /Hatch/ }).first().click().catch(() => {});
      await page.waitForTimeout(1800);
      await shot(page, `hcc/${tag}`);
      await crop(page, ".monsters-screen, .hatch", `hcc/${tag}-crop`, 4);
    } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `hcc/ERR-${tag}`); }
  }
  await context.close();
}
await browser.close();
