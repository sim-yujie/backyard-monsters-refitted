// Step 2 of the build: puts demo/index.html together from build/ (prep.mjs) and src/, with every picture and font inlined.
import fs from "node:fs";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3";
const PUB = `${W}/web/public`, B = `${W}/demo/build`, SRC = `${W}/demo/src`;
const MIME = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", woff2: "font/woff2", svg: "image/svg+xml" };
const missing = [];
const uri = (file0) => { const file = file0.startsWith(PUB + "/assets/") ? file0.replace(PUB, `${W}/server/public`) : file0; if (!fs.existsSync(file)) { missing.push(file); return null; } return `data:${MIME[file.split(".").pop()]};base64,${fs.readFileSync(file).toString("base64")}`; };
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

// Game CSS: the same pictures are named in both frame sheets, so each becomes one variable on the frame's root.
const SKIP = /^\/(ui\/skin\/flash|friends|ui\/stars)\//; // Classic look and other windows: not in this demo
const vars = new Map(); let fontCss = "";
const css = {};
for (const name of ["phone", "desktop"]) {
  let text = fs.readFileSync(`${B}/css-${name}.css`, "utf8");
  text = text.replace(/@font-face\s*\{[^}]*\}\n?/g, (rule) => { if (name === "phone" && /Titan One/.test(rule)) fontCss += rule.replace(/url\("(\/[^"]+)"\)/g, (_, p) => `url("${uri(PUB + p)}")`) + "\n"; return ""; });
  text = text.replace(/url\("(\/[^"]+)"\)/g, (_, p) => { if (SKIP.test(p)) return `url("${BLANK}")`; if (!vars.has(p)) vars.set(p, `--demo-art-${vars.size}`); return `var(${vars.get(p)})`; });
  css[name] = text;
}
const artCss = `#frame x-html{${[...vars].map(([p, v]) => `${v}:url("${uri(PUB + p) ?? BLANK}")`).join(";")}}`;

// Pictures the page draws itself.
const data = JSON.parse(fs.readFileSync(`${B}/data.json`, "utf8"));
const app = fs.readFileSync(`${SRC}/app.js`, "utf8");
const paths = new Set();
const blob = JSON.stringify(data).replace(/\\"/g, '"').replace(/&quot;/g, '"') + app;
for (const [p] of blob.matchAll(/\/(?:ui|portraits|assets)\/[\w@.\/-]+\.(?:webp|png)/g)) paths.add(p);
const icons = new Set(["townhall", "outpost", "housing", "time", "find", "pin", "lastarmy", "friendprev", "friendnext"]);
for (const p of [...paths]) { const m = p.match(/^\/ui\/icons\/([a-z0-9]+)-\d+\.webp$/); if (m) { icons.add(m[1]); paths.delete(p); } }
for (const name of icons) for (const size of [32, 48, 64]) paths.add(`/ui/icons/${name}-${size}.webp`);
for (const id of [...data.order, "C19"]) paths.add(`/portraits/${id}-icon.webp`);
for (const id of data.order) paths.add(`/portraits/${id}.webp`);
const assets = {};
for (const p of [...paths].sort()) { const u = uri(PUB + p); if (u) assets[p] = u; }
assets["backdrop-phone"] = uri(`${B}/backdrop-phone.jpg`);
assets["backdrop-desktop"] = uri(`${B}/backdrop-desktop.jpg`);

const safe = (js) => js.replace(/<\/script/gi, "<\\/script");
let html = fs.readFileSync(`${SRC}/page.html`, "utf8");
const put = (mark, value) => { html = html.replace(mark, () => value); };
put("/*GAME_FONTS_AND_ART*/", fontCss + artCss);
put("/*CSS_PHONE*/", css.phone);
put("/*CSS_DESKTOP*/", css.desktop);
put("/*CHROME_CSS*/", fs.readFileSync(`${SRC}/chrome.css`, "utf8"));
put("/*DATA*/", safe(`window.HCC_DATA=${JSON.stringify(data)};window.HCC_ASSETS=${JSON.stringify(assets)};`));
put("/*APP*/", safe(app));
fs.writeFileSync(`${W}/demo/index.html`, html);
console.log("index.html", (html.length / 1e6).toFixed(2), "MB;", Object.keys(assets).length, "pictures;", vars.size, "css pictures");
if (missing.length) console.log("MISSING", missing.join("\n"));
const left = html.match(/(?:src|href)="\/[^"]*"|url\("?\/[^)]*\)|https?:\/\/[^\s"')]+/g) || [];
console.log("leftover urls:", [...new Set(left)].slice(0, 20));
