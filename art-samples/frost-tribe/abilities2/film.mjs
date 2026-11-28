// Films one Baiter test fight on yardtester's clean yard, frame by frame (fake clock),
// so the mp4 plays smoothly at 30 fps at real speed.
//   node film.mjs <spec.json>
// spec: { name, look, params, army:[{name,level,count}], drops:[{pick,x,y,at}], zoomIn, seconds,
//         crop:{x,y,w,h}, probe, dsf, pan:{dx,dy} }
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
const require = createRequire("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/package.json");
const { chromium } = require("playwright");

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = "/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/9d4798b4-a9ad-4a0c-92cd-45603c5e8a7c/scratchpad/fa2/frames";
const dir = `${OUT}/${spec.name}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const DSF = spec.dsf ?? 1.5;

const browser = await chromium.launch({
  args: ["--mute-audio"],
  executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DSF });
await context.addInitScript((look) => {
  try {
    if (look === "classic") localStorage.setItem("bymr.look", "classic");
    else localStorage.removeItem("bymr.look");
  } catch {}
}, spec.look ?? "modern");
const page = await context.newPage();
// No seasonal dressing (the Thanksgiving leaves): the frost tribe is a Christmas tribe.
const unseason = (node) => {
  if (Array.isArray(node)) node.forEach(unseason);
  else if (node && typeof node === "object") {
    if (Array.isArray(node.activeevents)) node.activeevents = [];
    if ((node.kind === "thanksgiving" || node.kind === "halloween") && "status" in node) node.status = "ended";
    Object.values(node).forEach(unseason);
  }
};
await page.route(/\/base\/load|\/bm\/(yard\/)?events/, async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  try {
    const json = JSON.parse(body);
    unseason(json);
    body = JSON.stringify(json);
  } catch {}
  await route.fulfill({ response, body });
});
await page.clock.install();
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });
try {
  await page.goto(`http://localhost:5461/${spec.params ?? ""}`);
  await page.getByRole("textbox", { name: "Email" }).fill("yardtester@test.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Dev12345!");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Map", exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.mouse.click(1205, 368); // zoom out once: the Baiter comes into view
  await page.waitForTimeout(800);
  await page.mouse.click(187, 385); // the Baiter
  await page.waitForTimeout(1200);
  if (!(await page.getByRole("button", { name: "Test attack" }).isVisible())) {
    await page.mouse.click(1205, 368);
    await page.waitForTimeout(1500);
    await page.mouse.click(187, 385);
    await page.waitForTimeout(1200);
  }
  await page.getByRole("button", { name: "Test attack" }).click();
  await page.waitForTimeout(1500);
  for (const one of spec.army) {
    await page.getByRole("combobox", { name: `${one.name}'s level` }).selectOption({ label: `Level ${one.level}` });
    await page.getByRole("spinbutton", { name: `${one.name} in the test` }).fill(String(one.count));
  }
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Start test" }).click();
  await page.waitForTimeout(4000);
  await page.mouse.click(832, 192); // close the "nothing is saved" note
  await page.waitForTimeout(300);
  for (let i = 0; i < (spec.zoomIn ?? 0); i += 1) {
    await page.mouse.click(960, 758);
    await page.waitForTimeout(250);
  }
  if (spec.pan) {
    await page.mouse.move(640, 450);
    await page.mouse.down();
    await page.mouse.move(640 + spec.pan.dx / 2, 450 + spec.pan.dy / 2, { steps: 5 });
    await page.mouse.move(640 + spec.pan.dx, 450 + spec.pan.dy, { steps: 5 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1000);
  await shot("probe");
  if (!spec.probe) {
    // Freeze time, then drop and step frames.
    await page.clock.pauseAt(Date.now() + 1000);
    await page.clock.runFor(1000);
    const names = spec.army.map((one) => one.name);
    const fps = 30;
    const frames = Math.round((spec.seconds ?? 12) * fps);
    const drops = [...spec.drops].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    let next = 0;
    for (let f = 0; f < frames; f += 1) {
      const t = f / fps;
      while (next < drops.length && (drops[next].at ?? 0) <= t) {
        const drop = drops[next];
        await page.getByRole("button", { name: "Fill", exact: true }).nth(names.indexOf(drop.pick)).click();
        await page.mouse.click(drop.x, drop.y);
        next += 1;
      }
      await page.clock.runFor(1000 / fps);
      if (f % 5 === 4 && !(await page.getByRole("button", { name: "Stop" }).isVisible())) {
        // The fight is over and the yard is back: drop the last frames.
        for (let k = Math.max(0, f - 9); k < f; k += 1) rmSync(`${dir}/f${String(k).padStart(5, "0")}.jpg`, { force: true });
        console.log("fight over at frame", f);
        break;
      }
      const c = spec.crop;
      await page.screenshot({
        path: `${dir}/f${String(f).padStart(5, "0")}.jpg`,
        type: "jpeg",
        quality: 92,
        ...(c ? { clip: c } : {}),
      });
    }
  }
} catch (e) {
  await shot("error").catch(() => {});
  console.error("FAILED", String(e).slice(0, 600));
}
await context.close();
await browser.close();
if (!spec.probe) {
  execSync(
    `ffmpeg -y -loglevel error -framerate 30 -i ${dir}/f%05d.jpg -vf "scale=1280:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 22 -preset slow ${OUT}/${spec.name}.mp4`,
  );
}
console.log("done", spec.name);
