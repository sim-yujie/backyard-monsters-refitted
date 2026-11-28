// node ingame.mjs <round> [look...] : the gem icons (owner's pick C) in the Abilities view + Ability unlocked pop-up, both looks, desk + phone.
// Resets yardtester's crystals/abilities (db/reset.sql) before each screen so every run unlocks Drull's third.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/home/yujiesim/.nvm/versions/node/v26.13.1/lib/node_modules/@playwright/cli/package.json");
const { chromium } = require("playwright");
const round = process.argv[2] ?? "r1";
const looks = process.argv.length > 3 ? process.argv.slice(3) : ["modern", "classic"];
import { execSync } from "node:child_process";
const HERE = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon";
const reset = () => execSync(`cd ${HERE}/server && DB_NAME=${process.env.DB_NAME ?? "gem_final_db"} bun ../shots/art4/db/q.ts "$(cat ../shots/art5/db/reset.sql)"`, { stdio: "ignore", shell: "/bin/bash" });
const dir = `/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/art5/ingame/${round}`;
mkdirSync(dir, { recursive: true });
const SIZES = (process.env.SIZES ? JSON.parse(process.env.SIZES) : null) ?? [
  ["desk-1280x720", 1280, 720, 1, false],
  ["phone-390x844", 390, 844, 3, true],
];
const browser = await chromium.launch({
  args: ["--mute-audio", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
});
const clickText = (page, text) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button,[role=tab]")].find((x) => x.textContent.trim() === t && x.offsetParent);
  if (b) b.click();
  return !!b;
}, text);
for (const look of looks) {
  for (const [name, w, h, scale, touch] of SIZES) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch && w < 900 });
    await context.addInitScript((l) => { try { if (l === "classic") localStorage.setItem("bymr.look", "classic"); else localStorage.removeItem("bymr.look"); } catch {} }, look);
    const page = await context.newPage();
    const tag = `${look}-${name}`;
    reset();
    try {
      await page.goto(`http://localhost:${process.env.VITE_PORT ?? 5361}/`);
      await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
      await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page.locator(".yard-dock__button[data-dock=monsters]").first().waitFor({ state: "attached", timeout: 90000 });
      await page.waitForTimeout(6000);
      for (const t of ["Prepare defences", "Stay protected", "Close"]) await clickText(page, t);
      await page.keyboard.press("Escape");
      // Monsters > Champion > Abilities.
      const dock = page.locator(".yard-dock__button[data-dock=monsters]").first();
      if (!(await dock.isVisible())) {
        for (const holder of ["more", "menu"]) {
          const o = page.locator(`.yard-dock__button[data-dock="${holder}"]`);
          if (await o.isVisible()) { await o.click(); break; }
        }
        await page.waitForTimeout(600);
      }
      await dock.click();
      await page.waitForTimeout(1500);
      await page.locator(".monsters-screen").getByRole("tab", { name: "Champion" }).click();
      await page.waitForTimeout(800);
      await page.locator(".champion-tab__view").nth(1).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${dir}/${tag}-abilities.png` });
      // Drull's row: his Obsidian Hide slot picked, so the line under the rows names it.
      const drullRow = page.locator(".crystal-row").nth(1);
      await drullRow.scrollIntoViewIfNeeded().catch(() => {});
      const slot = drullRow.locator(".crystal-slot").nth(2);
      if (await slot.count()) { await slot.click().catch(() => {}); await page.waitForTimeout(600); }
      await page.screenshot({ path: `${dir}/${tag}-abilities-picked.png` });
      await page.locator(".crystal-abilities").first().screenshot({ path: `${dir}/${tag}-crop-abilities-picked.png` });
      const unlock = drullRow.locator(".crystal-row__unlock:not([disabled])").first();
      if (await unlock.count()) {
        await unlock.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${dir}/${tag}-confirm.png` });
        const go = page.locator(".crystal-dialog__go").first();
        if (await go.count()) {
          await go.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: `${dir}/${tag}-unlocked.png` });
          await page.locator(".crystal-dialog--unlocked").first().screenshot({ path: `${dir}/${tag}-crop-unlocked.png` }).catch(() => {});
          await page.keyboard.press("Escape");
          await page.waitForTimeout(800);
          await page.screenshot({ path: `${dir}/${tag}-abilities-after.png` });
          const korath = page.locator(".crystal-row").nth(3);
          await korath.scrollIntoViewIfNeeded().catch(() => {});
          await korath.locator(".crystal-slot").nth(1).click().catch(() => {});
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${dir}/${tag}-abilities-korath.png` });
          await page.locator(".crystal-abilities").first().screenshot({ path: `${dir}/${tag}-crop-abilities-korath.png` });
        }
      }
      console.log(tag, "ok");
    } catch (error) {
      await page.screenshot({ path: `${dir}/${tag}-error.png` }).catch(() => {});
      console.log(tag, "FAILED", String(error).slice(0, 200));
    }
    await context.close();
  }
}
await browser.close();
