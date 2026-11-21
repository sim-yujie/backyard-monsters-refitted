import { launch, open, shot, crop } from "./lib.mjs";
const NOTE_IN = ["SlimeQueen invited you to test their yard (24 h)", "Test"];
const NOTE_OUT = ["VorgLord tested your yard: Flattened, 100%", "Watch"];
const ALL = {
  "a-invite": ["b9baiter=a&b9tab=1", "baiter"],
  "a-invites": ["b9baiter=a&b9tab=2", "baiter", NOTE_IN],
  "a-host": ["b9baiter=a&b9host=SlimeQueen", "baiter"],
  "a-results": ["b9baiter=a&b9tab=3", "baiter", NOTE_OUT],
  "b-row": ["b9baiter=b", "row"],
  "b-invite": ["b9baiter=b&b9pane=invite", "tests"],
  "b-invited": ["b9baiter=b&b9pane=invited", "tests", NOTE_IN],
  "b-host": ["b9baiter=b&b9host=SlimeQueen", "baiter"],
  "b-results": ["b9baiter=b&b9pane=results", "tests", NOTE_OUT],
};
const jobs = (process.argv[2] || Object.keys(ALL).join(",")).split(",");
const looks = (process.argv[3] || "modern,classic").split(",");
const sizes = (process.argv[4] || "1280x720,390x844").split(",").map((s) => s.split("x").map(Number));
const browser = await launch();
for (const look of looks) for (const [w, h] of sizes) {
  const { context, page } = await open(browser, { w, h, look });
  for (const job of jobs) {
    const [query, where, note] = ALL[job];
    const tag = `${job}-${look}-${w}x${h}`;
    try {
      await page.goto(`http://localhost:5401/?skin=auto&${query}`);
      await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
      await page.waitForTimeout(3000);
      await page.keyboard.press("Escape").catch(() => {});
      if (note) { await page.evaluate(([t, a]) => window.__b9notice(t, a), note); await page.waitForTimeout(300); }
      let sel = ".popup, .panel";
      if (where === "baiter") {
        await page.evaluate(() => window.__yardSelect(592)); await page.waitForTimeout(1200);
        await page.getByRole("button", { name: "Test attack" }).first().click(); await page.waitForTimeout(1500);
        sel = ".baiter-window";
      } else {
        await page.getByRole("button", { name: /^Friends/ }).first().click(); await page.waitForTimeout(1500);
        if (where === "row") { await page.getByText("agenttester").first().click(); await page.waitForTimeout(800); sel = ".friends-window"; }
        else {
          await page.getByRole("button", { name: /All friends/ }).first().click(); await page.waitForTimeout(1500);
          await page.locator("#friends-tab-tests").scrollIntoViewIfNeeded().catch(() => {}); await page.locator("#friends-tab-tests").dispatchEvent("click"); await page.waitForTimeout(1000);
          sel = ".friends-screen";
        }
      }
      await shot(page, `baiter/${tag}`);
      await crop(page, sel, `baiter/${tag}-crop`, 4);
    } catch (e) { console.error(tag, String(e).slice(0, 300)); await shot(page, `baiter/ERR-${tag}`); }
  }
  await context.close();
}
await browser.close();
