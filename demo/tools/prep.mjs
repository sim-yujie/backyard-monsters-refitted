// Step 1 of the build (run once): from the captured game CSS and DOM, make
//   build/css-phone.css, build/css-desktop.css  (media queries resolved for the fixed frame, html/body retargeted)
//   build/data.json                             (window skeleton, monsters, yards)
import { createRequire } from "node:module";
import fs from "node:fs";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const require = createRequire(`${W}/web/package.json`);
const { chromium } = require("playwright");
const CAP = `${W}/demo/capture`, OUT = `${W}/demo/build`;
const read = (name) => JSON.parse(fs.readFileSync(`${CAP}/${name}.json`, "utf8"));
const sheets = read("css-r3-l3-remote-1280x720");
const browser = await chromium.launch({ args: ["--mute-audio"], executablePath: "/home/yujiesim/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell" });

for (const [name, w, h] of [["phone", 390, 844], ["desktop", 1280, 720]]) {
  const phone = name === "phone";
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  const page = await context.newPage();
  await page.setContent("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body></body></html>");
  if ((await page.evaluate(() => innerWidth)) !== w) throw new Error("viewport width is not " + w);
  const css = await page.evaluate((sheets) => {
    const sel = (s) => s.replace(/:root/g, ".x-root").replace(/(?<![\w\-.#\[="':])(html|body)(?![\w-])/g, "x-$1");
    const ser = (rule) => {
      const kids = () => [...(rule.cssRules || [])].map(ser).join("");
      switch (rule.constructor.name) {
        case "CSSMediaRule": return matchMedia(rule.media.mediaText).matches ? kids() : "";
        case "CSSStyleRule": return `${sel(rule.selectorText)}{${rule.style.cssText}${kids()}}\n`;
        case "CSSSupportsRule": return `@supports ${rule.conditionText}{${kids()}}\n`;
        case "CSSContainerRule": return `@container ${rule.conditionText ?? rule.containerName + " " + rule.containerQuery}{${kids()}}\n`;
        case "CSSLayerBlockRule": return `@layer ${rule.name}{${kids()}}\n`;
        case "CSSScopeRule": return rule.cssText + "\n";
        default: return rule.cssText + "\n";
      }
    };
    const kinds = {};
    const out = sheets.map(({ id, text }) => {
      const style = document.createElement("style"); style.textContent = text; document.head.append(style);
      const walk = (r) => { kinds[r.constructor.name] = (kinds[r.constructor.name] || 0) + 1; for (const k of r.cssRules || []) walk(k); };
      for (const r of style.sheet.cssRules) walk(r);
      const done = `/* ${id.split("/web/src/")[1] || id} */\n` + [...style.sheet.cssRules].map(ser).join("");
      style.remove(); return done;
    }).join("\n");
    return { out, kinds };
  }, sheets);
  let text = css.out.replace(/(?<![\w.#-])(\d*\.?\d+)[dsl]?(vh|vw)\b/g, (_, n, unit) => `${+(Number(n) * (unit === "vw" ? w : h) / 100).toFixed(2)}px`);
  fs.writeFileSync(`${OUT}/css-${name}.css`, text);
  console.log(name, text.length, JSON.stringify(css.kinds), (text.match(/x-html/g) || []).length, (text.match(/x-body/g) || []).length, (text.match(/\.x-root/g) || []).length, (text.match(/@container[^{]*/g) || []).slice(0, 3));
  if (phone) {
    const monsters = read("monsters"), remote = read("r3-l3-remote-1280x720"), yardsCap = read("r3-l3-yards-1280x720"), full = read("r3-l2-1280x720");
    const data = await page.evaluate(({ monsters, remote, yardsCap }) => {
      const dom = (html) => new DOMParser().parseFromString(html, "text/html");
      const strip = (root) => { for (const n of root.querySelectorAll("[srcset],[loading],[data-focus-key],[data-tut]")) for (const a of ["srcset", "sizes", "loading", "decoding", "data-focus-key", "data-tut"]) n.removeAttribute(a); };
      const doc = dom(remote.html); strip(doc);
      const panel = doc.querySelector(".monsters-screen"); panel.removeAttribute("style");
      const layer = panel.parentElement;
      const hatch = panel.querySelector(".hatch");
      const info = hatch.querySelector(".hatch-info");
      const out = { layerStyle: layer.getAttribute("style"), grid: hatch.querySelector(".hatch__grid").outerHTML, boosts: hatch.querySelector(".hatch-boosts").innerHTML, add: hatch.querySelector(".hatch-add").outerHTML, monsters: {}, order: [], yards: [] };
      const secs = (t) => [...t.matchAll(/(\d+)\s*([dhms])/g)].reduce((s, [, n, u]) => s + n * { d: 86400, h: 3600, m: 60, s: 1 }[u], 0);
      for (const [id, one] of Object.entries(monsters)) {
        if (!one.info) continue;
        const d = dom(one.info); strip(d); const box = d.querySelector(".hatch-info"); box.querySelector(".hatch-add")?.remove();
        const each = box.querySelector(".hatch-info__each");
        out.monsters[id] = { name: box.querySelector(".hatch-info__name").textContent, price: Number(each.querySelector(".res-amount__value").textContent.replace(/,/g, "")),
          time: secs(each.querySelector("[data-icon=time] .icon-amount__value").textContent), timeText: each.querySelector("[data-icon=time] .icon-amount__value").textContent,
          space: Number(each.querySelector("[data-icon=housing] .icon-amount__value").textContent.replace(/,/g, "")), info: box.innerHTML, label: box.getAttribute("aria-label") };
        out.order.push(id);
      }
      hatch.querySelector(".hatch__scroll").replaceChildren(); hatch.querySelector(".b9r2h-strip").replaceChildren();
      hatch.querySelector(".b9r2h-yards").replaceChildren(); hatch.className = "hatch b9r2h";
      out.panel = panel.outerHTML;
      const y = dom(yardsCap.html);
      for (const card of y.querySelectorAll(".b9r2h-yardcard")) out.yards.push({ title: card.querySelector(".b9r2h-yardcard__name").textContent, kind: card.querySelector(".game-icon--townhall") ? "main" : "outpost", hcc: !card.classList.contains("b9r2h-yardcard--off"), pinned: !!card.querySelector(".b9r2h-yardcard__pin"), shown: card.querySelector(".b9r2h-yardcard__queue span")?.textContent ?? "" });
      out.lock = y.querySelector(".b9r2h-yardcard--off svg")?.outerHTML;
      return out;
    }, { monsters, remote, yardsCap });
    data.layerStyle = { desktop: read("r3-l2-1280x720").html.match(/class="overlay__layer" style="([^"]*)"/)?.[1], phone: read("r3-l2-390x844").html.match(/class="overlay__layer" style="([^"]*)"/)?.[1] };
    data.panelStyle = { desktop: read("r3-l2-1280x720").html.match(/monsters-screen[^>]*style="([^"]*)"/)?.[1] ?? "", phone: read("r3-l2-390x844").html.match(/monsters-screen[^>]*style="([^"]*)"/)?.[1] ?? "" };
    fs.writeFileSync(`${OUT}/data.json`, JSON.stringify(data, null, 1));
    console.log("data", data.order.join(","), data.yards.length, JSON.stringify(data.layerStyle), JSON.stringify(data.panelStyle), data.panel.length);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(data.monsters).map(([k, v]) => [k, [v.name, v.price, v.time, v.space]]))));
    console.log(JSON.stringify(data.yards));
  }
  await context.close();
}
await browser.close();
