// Films every Q1 and Q2 option in one session, then cuts each into its own mp4 (<= 8 s):
//   node film.mjs <modern|classic> <W> <H> <outdir>
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openMap, SHOTS } from "./lib.mjs";
const [skin, w, h, outdir] = process.argv.slice(2);
const W = +w, H = +h;
const dir = `${SHOTS}/${outdir}`;
const raw = `${dir}/raw`;
mkdirSync(raw, { recursive: true });
const tag = `${W}x${H}-${skin}`;
const { browser, context, page, t0 } = await openMap({ skin, W, H, video: raw });
const run = (fn, arg) => page.evaluate(fn, arg);
const marks = [];
const clip = async (name, body) => {
  const start = (Date.now() - t0) / 1000;
  await body();
  marks.push({ name, start, end: (Date.now() - t0) / 1000 });
  console.log("clip", name);
};
const clean = async () => {
  await run(() => { __liveDemo.deselect(); __liveDemo.reset(); });
  await page.waitForTimeout(800);
};
try {
  await run(() => __liveDemo.view(240, 207, 0.8));
  await page.waitForTimeout(3000);
  for (const opt of ["A", "B", "C"]) {
    await run((o) => __liveDemo.use({ q1: o }), opt);
    await clip(`q1-${opt}`, async () => {
      await page.waitForTimeout(500);
      await run(() => __liveDemo.attack(240, 209));
      await page.waitForTimeout(700);
      await run(() => __liveDemo.taken(242, 208));
      await page.waitForTimeout(500);
      // then a busy stretch: 12 more cells in 4 s
      await run(() => __liveDemo.storm({ count: 12, seconds: 4, seed: 7 }));
      await page.waitForTimeout(5200);
    });
    await clean();
  }
  for (const opt of ["A", "B", "C"]) {
    await run((o) => __liveDemo.use({ q2: o, q1: "B" }), opt);
    await run(() => __liveDemo.select(242, 207));
    await page.waitForTimeout(1800);
    await clip(`q2-${opt}-taken`, async () => {
      await page.waitForTimeout(800);
      await run(() => __liveDemo.taken(242, 207));
      await page.waitForTimeout(3000);
      if (opt !== "B") await page.locator(".mr2-live-bar").click();
      await page.waitForTimeout(opt === "B" ? 3500 : 2500);
    });
    await clean();
    await run(() => __liveDemo.select(241, 207));
    await page.waitForTimeout(1800);
    await clip(`q2-${opt}-attack`, async () => {
      await page.waitForTimeout(800);
      await run(() => __liveDemo.attack(241, 207));
      await page.waitForTimeout(2800);
      if (opt === "C") {
        await page.locator(".mr2-live-bar").click();
        await page.waitForTimeout(800);
      }
      await run(() => __liveDemo.attackEnd(241, 207));
      await page.waitForTimeout(opt === "C" ? 2200 : 3000);
    });
    await clean();
  }
} catch (e) {
  console.error("FAILED", String(e).slice(0, 400));
}
const video = page.video();
await context.close();
await browser.close();
const webm = `${raw}/${tag}.webm`;
if (video) renameSync(await video.path(), webm);
writeFileSync(`${raw}/${tag}.json`, JSON.stringify(marks));
for (const m of marks) {
  const length = Math.min(8, m.end - m.start + 0.2);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(Math.max(0, m.start - 0.1)), "-i", webm, "-t", String(length),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", "-an", `${dir}/${m.name}-${tag}.mp4`]);
  console.log("mp4", m.name, length.toFixed(1));
}
