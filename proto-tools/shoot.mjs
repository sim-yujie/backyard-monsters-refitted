// All prototype stills for one look and one screen size:
//   node shoot.mjs <modern|classic> <W> <H> <scale> <outdir> [questions=123]
import { mkdirSync } from "node:fs";
import { openMap, demo, SHOTS } from "./lib.mjs";
const [skin, w, h, s, outdir, qs = "123"] = process.argv.slice(2);
const W = +w, H = +h;
const dir = `${SHOTS}/${outdir}`;
mkdirSync(dir, { recursive: true });
const tag = `${W}x${H}-${skin}`;
const { browser, page } = await openMap({ skin, W, H, scale: +s });
const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${dir}/${name}-${tag}.png` });
  console.log("shot", name);
};
const run = (fn, arg) => page.evaluate(fn, arg);
const ZOOM = +(process.env.ZOOM ?? 0.8);
const home = async () => {
  await run((z) => __liveDemo.view(240, 207, z), ZOOM);
  await page.waitForTimeout(2500);
};
const clean = async () => {
  await run(() => { __liveDemo.deselect(); __liveDemo.reset(); __liveDemo.restore({ instant: true }); });
  await page.waitForTimeout(700);
};
await home();

try {
  if (qs.includes("1")) {
    for (const opt of ["A", "B", "C"]) {
      await run((o) => __liveDemo.use({ q1: o }), opt);
      // A few changes that matter differently: own outpost attacked, camps taken, a yard shielded.
      await run(() => {
        __liveDemo.attack(240, 209);
        __liveDemo.taken(242, 208);
        __liveDemo.taken(237, 209);
        __liveDemo.shield(241, 207);
        __liveDemo.minor(243, 210);
        __liveDemo.freeze(0.12);
      });
      await shot(`q1-${opt}-few`);
      await clean();
      // A busy zone: 14 cells within 2 s, the clock stopped mid-way (each pulse at its own phase).
      await run(() => __liveDemo.storm({ count: 14, seconds: 2, seed: 7 }));
      await page.waitForTimeout(1500);
      await run(() => __liveDemo.stop());
      await shot(`q1-${opt}-busy`);
      await clean();
    }
  }
  if (qs.includes("3")) {
    for (const opt of ["A", "B", "C"]) {
      await run((o) => __liveDemo.use({ q3: o }), opt);
      await run(() => __liveDemo.drop({ instant: true }));
      await shot(`q3-${opt}-down`);
      await run(() => __liveDemo.back());
      await shot(`q3-${opt}-live`);
      await clean();
    }
  }
  if (qs.includes("2")) {
    for (const opt of ["A", "B", "C"]) {
      await run((o) => __liveDemo.use({ q2: o, q1: "B" }), opt);
      // Taken: a camp's panel is open when another player takes it.
      await run(() => __liveDemo.select(242, 207));
      await page.waitForTimeout(1500);
      await run(() => __liveDemo.taken(242, 207));
      await page.waitForTimeout(300);
      await run(() => __liveDemo.freeze(0.1));
      await shot(`q2-${opt}-taken`);
      await clean();
      // Attack: a yard's panel is open when someone starts attacking it.
      await run(() => __liveDemo.select(241, 207));
      await page.waitForTimeout(1500);
      await run(() => __liveDemo.attack(241, 207));
      await page.waitForTimeout(300);
      await run(() => __liveDemo.freeze(0.1));
      await shot(`q2-${opt}-attack`);
      await clean();
    }
  }
} catch (e) {
  console.error("FAILED", String(e).slice(0, 500));
  await page.screenshot({ path: `${dir}/error-${tag}.png` }).catch(() => {});
}
await browser.close();
