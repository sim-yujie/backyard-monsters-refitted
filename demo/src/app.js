/*
 * HCC Level 2/3 demo, round 3: the "workbench" with the Monsters | Presets switch.
 * A stand-alone copy of the design prototype on design/b9-hcc-r3 (web/src/proto/b9HccR3.ts):
 * the window, the Hatch tab and the prototype's parts are the game's own markup and CSS; this file
 * only plays the game's part (a pretend yard, queue and timers). Demo data, nothing is saved.
 *
 * Build: tools/prep.mjs (game captures -> build/), then tools/build.mjs (-> index.html). Check: tools/shots.mjs.
 * Address options after "#", joined with "&": level=2|3, frame=phone|desktop,
 * state=busy,room,remote,yards,housing,presets,empty,filled,edit,sent (the prototype's picture states),
 * bare (frame only, 1:1), paused (clock stopped).
 */
(() => {
  "use strict";
  const D = window.HCC_DATA;
  const ASSETS = window.HCC_ASSETS || {};
  const M = D.monsters;
  /** Rezghul is locked in the demo's yard: preset 5 of the `filled` state shows a locked monster being skipped. */
  const LOCKED = "C19";
  if (!M[LOCKED]) M[LOCKED] = { name: "Rezghul", price: 1_000_000, locked: true };

  /** Game seconds that pass per real second. */
  const SPEED = 10;
  const TICK_MS = 500;

  /** Presets a list holds: 2 at HCC level 1, 4 at level 2, 6 at level 3 (owner, 22 Nov). */
  const slots = () => (S.level >= 3 ? 6 : S.level >= 2 ? 4 : 2);
  /** Boxes (stacks) the queue holds: today's 7 at level 1, 10 from level 2. */
  const stacks = () => (S.level >= 2 ? 10 : 7);

  const hash = new Map(location.hash.replace(/^#/, "").split("&").filter(Boolean).map((p) => p.split("=").map(decodeURIComponent)));
  const flags = new Set((hash.get("state") || "").split(",").filter(Boolean));
  const BARE = hash.has("bare");
  const PAUSED = hash.has("paused");

  const S = {
    level: [1, 2, 3].includes(Number(hash.get("level"))) ? Number(hash.get("level")) : 2,
    frame: hash.get("frame") === "desktop" ? "desktop" : "phone",
    at: 0, // index into the yards that have an HCC; 0 = home
    sel: "C1",
    count: 0,
    tab: "monsters",
    editing: null, // the preset slot being built
    sent: null, // what the last Send did: { scope, slot, added, of, why }
    yardsOpen: false,
    showHousing: false,
    details: false,
    boosts: false,
    find: "",
  };
  let yards = [];
  let presets = { main: [], outposts: [] };

  /* ── Small helpers ─────────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const asset = (path) => ASSETS[path] || path;
  const twice = (path) => path.replace(/^(\/ui\/icons\/[a-z0-9]+)-(16|24|32)\.webp$/, (_, name, size) => `${name}-${size * 2}.webp`);
  /** Captured game markup: point its pictures at the inlined art (icons at twice the size, for sharp phones). */
  const fix = (html) =>
    html
      .replace(/src="(\/[^"]+)"/g, (_, path) => `src="${asset(twice(path))}"`)
      .replace(/url\(&quot;(\/[^&]+)&quot;\)/g, (_, path) => `url(&quot;${asset(path)}&quot;)`);
  const icon = (name, size, cls = "") =>
    `<img class="game-icon game-icon--${name}${cls ? " " + cls : ""}" data-icon="${name}" width="${size}" height="${size}" src="${asset(`/ui/icons/${name}-${size * 2}.webp`)}" alt="" aria-hidden="true" draggable="false">`;
  const face = (id, cls) => `<img class="monster-picture ${cls}" src="${asset(`/portraits/${id}-icon.webp`)}" alt="">`;
  const GOO_ICON = `<span class="res-icon res-icon--r4" role="img" data-realm="surface" aria-label="Goo" style="background-image: url(&quot;${asset("/assets/popups/resourcegoo.png")}&quot;); background-size: 100% 152.381%; background-position: 0% 50%; aspect-ratio: 128 / 84;"></span>`;
  const SHINY_ICON = `<span class="res-icon res-icon--shiny" aria-hidden="true" data-realm="surface" style="background-image: url(&quot;${asset("/assets/alliances/shiny-icon.png")}&quot;); background-size: 100% 100%; background-position: 0% 0%; aspect-ratio: 40 / 41;"></span>`;
  const num = (value) => Math.round(value).toLocaleString("en-US");
  const short = (value) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1000)}K` : num(value));
  const clock = (seconds) => {
    const s = Math.max(0, Math.ceil(seconds));
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };
  const plural = (name, count) => (count === 1 ? name : `${name}s`);
  const stackSize = () => (S.level >= 3 ? 30 : 20);

  /* ── The pretend yards ─────────────────────────────────────────────── */
  const stacksOf = (pairs) => pairs.map(([id, count]) => [id, count]);
  const making = (id, part) => ({ monster: id, left: Math.round(M[id].time * part), total: M[id].time, stalled: false });
  const idle = () => ({ monster: null, left: 0, total: 0, stalled: false });

  function reset() {
    const size = stackSize();
    const busy = flags.has("busy");
    const home = { capacity: 2160, goo: 60_400_000 };
    if (busy) {
      // The prototype's own picture state: ten full stacks, housing full, every hatchery waiting.
      home.housed = 2080;
      home.queue = stacksOf([["C12", size - 1], ["C12", size], ["C8", size], ["C8", size], ["C7", size], ["C14", size], ["C5", size], ["C3", size], ["C1", size], ["C6", Math.round(size / 2)]]).slice(0, stacks() - (flags.has("room") ? 2 : 0));
      home.hatcheries = [1, 2, 3, 4, 5].map(() => ({ monster: "C12", left: 0, total: M.C12.time, stalled: true }));
    } else {
      home.housed = 640;
      home.queue = stacksOf([["C8", size], ["C7", size], ["C2", 12]]);
      home.hatcheries = [making("C8", 0.3), making("C8", 0.55), making("C7", 0.4), making("C7", 0.8), making("C2", 1)];
    }
    yards = D.yards.map((yard, index) => {
      if (yard.kind === "main") return { ...yard, ...home };
      const total = Number(yard.shown.replace(/\D/g, "")) || 0;
      const base = { ...yard, capacity: 9600, housed: 3200, goo: 18_400_000, queue: [], hatcheries: [idle(), idle()] };
      if (index === 1) {
        base.queue = stacksOf([["C7", size], ["C7", size], ["C2", size], ["C2", size], ["C1", size - 4]]);
        base.hatcheries = [0, 1].map(() => ({ monster: "C7", left: 620, total: 620, stalled: false })); // the prototype's own figure
      } else if (total >= 100) {
        base.queue = stacksOf([["C7", size], ["C7", size], ["C2", size], ["C2", size]]);
        base.hatcheries = [making("C7", 0.5), making("C2", 0.7)];
      } else if (total > 0) {
        base.queue = stacksOf([["C7", size], ["C2", size]]);
        base.hatcheries = [making("C7", 0.6), making("C2", 1)];
      }
      return base;
    });
    const MAIN = [[["C1", 30], ["C2", 40], ["C1", 30]], [["C12", 40], ["C5", 40], ["C12", 20]], [["C14", size], ["C13", size], ["C3", size], ["C6", size], ["C1", size], ["C2", size], ["C12", size], ["C5", size / 2]], [["C6", 100], ["C9", 40]], [["C2", 60], [LOCKED, 30], ["C4", 60]], [["C8", 60], ["C7", 30]]];
    const OUTPOSTS = [[["C7", 60], ["C2", 40]], [["C1", 60]], [["C8", 30], ["C5", 30]], [["C6", 90]], [["C3", 60], ["C4", 30], ["C1", 30]], [["C2", 90], ["C7", 30]]];
    // The demo starts with every preset but the last made, so each level shows its list and has a slot to build in.
    const filled = flags.has("empty") ? 0 : flags.has("filled") ? slots() : slots() - 1;
    const list = (from) => Array.from({ length: slots() }, (_, at) => (at < filled ? stacksOf(from[at]) : []));
    presets = { main: list(MAIN), outposts: list(OUTPOSTS) };
    S.at = 0;
    S.count = 0;
    S.tab = "monsters";
    S.editing = null;
    S.sent = null;
    S.yardsOpen = false;
    S.showHousing = false;
    S.boosts = false;
    S.find = "";
    if (S.level >= 3 && flags.has("remote")) S.at = 1;
    if (S.level >= 3 && flags.has("yards")) S.yardsOpen = true;
    if (flags.has("housing")) S.showHousing = true;
    if (flags.has("presets") || flags.has("edit") || flags.has("sent")) S.tab = "presets";
    if (flags.has("edit")) {
      S.editing = 0;
      if (flags.has("empty")) presetList()[0] = [["C1", 30], ["C2", 40]];
    }
    if (flags.has("sent")) send(0);
  }

  const hccYards = () => yards.filter((one) => one.hcc);
  const yard = () => hccYards()[S.at] || yards[0];
  const remote = () => S.at > 0;
  const scope = () => (remote() ? "outposts" : "main");
  const presetList = () => presets[scope()];
  const totalOf = (preset) => preset.reduce((sum, [, count]) => sum + count, 0);
  const gooOf = (preset) => preset.reduce((sum, [id, count]) => sum + count * M[id].price, 0);
  const stacksIn = (preset) => preset.reduce((sum, [, count]) => sum + Math.ceil(count / stackSize()), 0);
  const queued = (one) => one.queue.reduce((sum, [, count]) => sum + count, 0);
  const pendingSpace = (one) =>
    one.queue.reduce((sum, [id, count]) => sum + count * M[id].space, 0) + one.hatcheries.reduce((sum, h) => sum + (h.monster ? M[h.monster].space : 0), 0);
  const doneIn = (one) => {
    const work = one.queue.reduce((sum, [id, count]) => sum + count * M[id].time, 0) + one.hatcheries.reduce((sum, h) => sum + (h.monster ? h.left : 0), 0);
    return work / Math.max(1, one.hatcheries.length);
  };

  /** The game's rule: a monster joins the LAST stack when it is the same kind and not full, else starts a new one. */
  const push = (queue, id) => {
    const last = queue[queue.length - 1];
    if (last && last[0] === id && last[1] < stackSize()) {
      last[1] += 1;
      return true;
    }
    if (queue.length >= stacks()) return false;
    queue.push([id, 1]);
    return true;
  };
  /** Adds up to `count`; stops at the queue's end or when the goo runs out (as the game's Add does today). */
  const addTo = (one, id, count) => {
    let added = 0;
    let stoppedBy = null;
    while (added < count) {
      if (M[id].price > one.goo) {
        stoppedBy = "goo";
        break;
      }
      if (!push(one.queue, id)) {
        stoppedBy = "queue";
        break;
      }
      one.goo -= M[id].price;
      added += 1;
    }
    return { added, stoppedBy };
  };
  const roomFor = (one, id) => {
    const last = one.queue[one.queue.length - 1];
    const inLast = last && last[0] === id ? stackSize() - last[1] : 0;
    const queue = (stacks() - one.queue.length) * stackSize() + inLast;
    return { queue, fill: Math.max(0, Math.min(queue, Math.floor(one.goo / M[id].price))) };
  };
  const clearQueue = (one) => {
    for (const [id, count] of one.queue) one.goo += count * M[id].price;
    one.queue = [];
  };

  /** Send: the preset joins the END of the queue, as far as the stacks and the goo go. */
  function send(at) {
    const one = yard();
    const preset = presetList()[at];
    if (!preset || !preset.length) return;
    let added = 0;
    let why = null;
    const skipped = [];
    for (const [id, count] of preset) {
      if (M[id].locked) {
        if (!skipped.includes(M[id].name)) skipped.push(M[id].name);
        continue;
      }
      const report = addTo(one, id, count);
      added += report.added;
      if (report.stoppedBy) {
        why = report.stoppedBy;
        break;
      }
    }
    S.sent = { scope: scope(), slot: at, added, of: totalOf(preset), why, skipped };
  }

  function tick(seconds) {
    for (const one of yards) {
      if (!one.hcc) continue;
      for (const h of one.hatcheries) {
        let time = seconds;
        let guard = 0;
        while (time > 0 && guard++ < 50) {
          if (!h.monster) {
            const first = one.queue[0];
            if (!first) break;
            first[1] -= 1;
            if (first[1] <= 0) one.queue.shift();
            h.monster = first[0];
            h.left = h.total = M[first[0]].time;
            h.stalled = false;
          }
          const step = Math.min(time, h.left);
          h.left -= step;
          time -= step;
          if (h.left > 0) break;
          const space = M[h.monster].space;
          if (one.housed + space > one.capacity) {
            h.stalled = true; // hatched, waiting for housing
            break;
          }
          one.housed += space;
          h.monster = null;
          h.stalled = false;
        }
      }
    }
  }

  /* ── The frame ─────────────────────────────────────────────────────── */
  const frame = $("#frame");
  const root = document.createElement("x-html");
  root.className = "x-root";
  root.setAttribute("lang", "en");
  root.dataset.theme = "dark";
  root.dataset.skin = "scrap";
  root.innerHTML = `<x-body><div id="game-root"><img class="demo-backdrop" alt="" draggable="false"><div class="overlay"><div class="overlay__layer">${fix(D.panel)}</div><div class="overlay__layer overlay__layer--modal"></div></div></div></x-body>`;
  frame.append(root);
  const layer = $(".overlay__layer", root);
  const panel = $(".monsters-screen", root);
  const hatch = $(".hatch", root);
  const strip = $(".b9r2h-strip", hatch);
  const scroll = $(".hatch__scroll", hatch);
  const status = $(".hatch__status", hatch);
  const yardsPage = $(".b9r2h-yards", hatch);

  // The scroll area, built once; the prototype moves the line into or out of the bench per option.
  scroll.innerHTML =
    `<div class="b9r2h-bench"></div>` +
    `<div class="hatch-boosts" id="hatch-boosts" hidden>${fix(D.boosts)}</div>` +
    `<div class="b9r3h-tabs" role="tablist"></div><div class="hatch-message"></div><section class="b9r3h-presets" aria-label="Presets"></section>` +
    `<div class="hatch__split"><section class="hatch-pick" aria-label="Monsters">${fix(D.grid)}</section><section class="hatch-info"></section></div>`;
  const bench = $(".b9r2h-bench", scroll);
  const boosts = $(".hatch-boosts", scroll);
  const message = $(".hatch-message", scroll);
  const info = $(".hatch-info", scroll);
  const tabsRow = $(".b9r3h-tabs", scroll);
  const list = $(".b9r3h-presets", scroll);
  const editHead = document.createElement("div");
  editHead.className = "b9r3h-edit";
  const editBox = document.createElement("div");
  editBox.className = "b9r3h-set hatch-add";
  const rail = document.createElement("section");
  rail.className = "b9r5h-rail";
  rail.setAttribute("aria-label", "Send a preset");
  const lines = document.createElement("section");
  lines.className = "hatch-lines";
  lines.setAttribute("aria-label", "Hatching line");
  lines.innerHTML = `<div class="hatch-line hatch-line--hcc"><div class="hatch-line__now" role="group" aria-label="Hatching now"></div><div class="hatch-line__slots" role="group" aria-label="Waiting"></div></div>`;
  const nowRow = $(".hatch-line__now", lines);
  const slotRow = $(".hatch-line__slots", lines);
  const holder = document.createElement("div");
  holder.innerHTML = fix(D.add);
  const add = holder.firstElementChild;
  const addCount = $(".hatch-add__count", add);
  const addButton = $(".hatch-add__add", add);
  const addGate = $(".hatch-add__gate", add);
  const addWarning = $(".hatch-add__warning", add);
  const addFill = $(".hatch-add__fill", add);

  /* ── Drawing ───────────────────────────────────────────────────────── */
  function drawShell() {
    const editing = S.editing !== null;
    hatch.className = `hatch b9r2h b9r2h-opt-d b9r3h b9r2h-level-${S.level}${remote() ? " b9r2h-remote" : ""}${S.showHousing ? " b9r2h-show-housing" : ""}${S.tab === "presets" && !editing ? " b9r3h-on-presets" : ""}${editing ? " b9r3h-editing" : ""}${flags.has("live") ? " b9r3h-live" : ""}`;
    // Round 4: building a preset hides the hatcheries and the queue; the tab keeps the height it had.
    if (!editing || flags.has("live")) hatch.style.minHeight = "";
    if (lines.parentElement !== bench) bench.replaceChildren(lines, rail);
    boosts.hidden = !S.boosts;
  }

  const where = () => {
    const of = hccYards().length;
    return `<span class="b9r2h-where">${icon(remote() ? "outpost" : "townhall", 32, "b9r2h-where__icon")}<span class="b9r2h-where__count">${S.at + 1}/${of}</span></span>`;
  };

  function drawStrip() {
    const parts = [];
    if (S.level < 3) {
      parts.push(
        `<button class="b9r2h-yard b9r2h-yard--locked" type="button" aria-label="Run your outposts from here at HCC level 3" disabled>${icon("outpost", 32, "b9r2h-where__icon")}${D.lock}<span class="b9r2h-lock__level">3</span></button>`,
      );
    } else {
      if (remote()) parts.push(`<button class="b9r2h-yard b9r2h-yard--home" type="button" data-act="home" aria-label="Back to the main yard">${icon("townhall", 32, "b9r2h-where__icon")}</button>`);
      {
        const of = hccYards().length;
        parts.push(
          `<div class="b9r2h-stepper"><button class="b9r2h-stepper__arrow" type="button" data-act="step" data-by="-1" aria-label="Previous yard"${S.at <= 0 ? " disabled" : ""}>${icon("friendprev", 32, "b9r2h-arrow")}</button>` +
            `<button class="b9r2h-stepper__where" type="button" data-act="yards" aria-label="All your yards with an HCC">${where()}</button>` +
            `<button class="b9r2h-stepper__arrow" type="button" data-act="step" data-by="1" aria-label="Next yard"${S.at >= of - 1 ? " disabled" : ""}>${icon("friendnext", 32, "b9r2h-arrow")}</button></div>`,
        );
      }
    }
    parts.push(
      `<button class="b9r2h-housing" type="button" data-act="housing"><span class="b9r2h-housing__numbers">${icon("housing", 24, "b9r2h-housing__icon")}<span class="b9r2h-housing__now"></span><span class="b9r2h-housing__compact"></span><span class="b9r2h-housing__coming"></span></span><span class="b9r2h-housing__bar"><span class="b9r2h-housing__fill"></span><span class="b9r2h-housing__more"></span></span></button>`,
    );
    strip.innerHTML = parts.join("");
    drawHousing();
  }

  /** The strip's housing figures and the tab's own housing box (patched in place: it is redrawn on every tick). */
  function drawHousing() {
    const one = yard();
    const coming = pendingSpace(one);
    const adding = S.count * M[S.sel].space;
    const box = $(".b9r2h-housing", strip);
    if (box) {
      box.classList.toggle("b9r2h-housing--over", one.housed + coming > one.capacity);
      box.setAttribute("aria-label", `Housing ${one.housed} of ${one.capacity}; queue adds ${coming}`);
      $(".b9r2h-housing__now", box).textContent = `${num(one.housed)}/${num(one.capacity)}`;
      $(".b9r2h-housing__compact", box).textContent = `${(one.housed / 1000).toFixed(1)}K/${(one.capacity / 1000).toFixed(1)}K`;
      $(".b9r2h-housing__coming", box).textContent = `+${short(coming)}`;
      $(".b9r2h-housing__fill", box).style.width = `${Math.min(100, (one.housed / one.capacity) * 100)}%`;
      $(".b9r2h-housing__more", box).style.width = `${Math.max(0, Math.min(100, ((one.housed + coming) / one.capacity) * 100) - (one.housed / one.capacity) * 100)}%`;
    }
    const total = one.housed + coming + adding;
    const scale = Math.max(one.capacity, total);
    const pct = (value) => `${((value / scale) * 100).toFixed(2)}%`;
    const over = total - one.capacity;
    const what = adding ? "Housing after this add" : "Housing after this line";
    message.innerHTML =
      `<div class="hatch-housing${over > 0 ? " hatch-housing--over" : ""}"><span class="hatch-housing__label">${icon("housing", 24)}</span>` +
      `<span class="hatch-housing__value" title="${what}"><span class="hatch-housing__after">After:</span> ${num(total)} / ${num(one.capacity)}</span>` +
      `<div class="hatch-housing__bar" role="meter" aria-label="${what}"><span class="hatch-housing__part hatch-housing__part--housed" style="width: ${pct(one.housed)};"></span><span class="hatch-housing__part hatch-housing__part--pending" style="width: ${pct(coming)};"></span>${adding ? `<span class="hatch-housing__part hatch-housing__part--adding" style="width: ${pct(adding)};"></span>` : ""}</div>` +
      `<span class="hatch-housing__foot"><span class="hatch-housing__key" aria-hidden="true"><span class="hatch-housing__item hatch-housing__item--housed">${num(one.housed)}</span><span class="hatch-housing__item hatch-housing__item--pending">${num(coming)}</span>${adding ? `<span class="hatch-housing__item hatch-housing__item--adding">+${num(adding)}</span>` : ""}</span>` +
      `${over > 0 ? `<span class="hatch-housing__over">${num(over)} over: they wait for room</span>` : ""}</span></div>`;
    // The window's own housing line (hidden by the prototype's strip on most sizes) follows too.
    const head = $(".monsters-header__value", panel);
    if (head) head.textContent = `${num(one.housed)} / ${num(one.capacity)}`;
    const fill = $(".monsters-bar__fill", panel);
    if (fill) fill.style.width = `${Math.min(100, (one.housed / one.capacity) * 100).toFixed(1)}%`;
  }

  let linesKey = "";
  /** The hatcheries and the ten stacks. Redrawn only when their make-up changes, so a tap is never lost to a tick. */
  function drawLines(force) {
    const one = yard();
    const key = `${S.at}|${S.level}|` + one.hatcheries.map((h) => `${h.monster}${h.stalled ? "!" : ""}`).join(",") + "|" + one.queue.map(([id]) => id).join(",");
    if (force || key !== linesKey) {
      linesKey = key;
      nowRow.innerHTML =
        one.hatcheries
          .map((h, index) => {
            const label = `<span class="hatch-now__label"><span class="hatch-now__label-word">Hatchery</span> <span class="hatch-now__label-number">${index + 1}</span></span>`;
            if (!h.monster) return `<div class="hatch-now hatch-now--idle hatch-now--compact" data-hatchery="${index}" title="Hatchery ${index + 1}: nothing hatching">${label}</div>`;
            const name = M[h.monster].name;
            const state = h.stalled
              ? `<span class="hatch-now__state"><span class="hatch-now__words-long">Needs housing</span><span class="hatch-now__words-short" aria-hidden="true">Full</span></span>`
              : `<span class="hatch-now__state hatch-clock"></span>`;
            return (
              `<button class="hatch-now hatch-now--${h.stalled ? "stalled" : "producing"} hatch-now--compact" data-act="cancel" data-hatchery="${index}" type="button" aria-label="Hatchery ${index + 1}: ${name} hatching now. Cancel it and get the goo back">${label} ` +
              `<span class="hatch-now__body">${face(h.monster, "hatch-now__picture")}<span class="hatch-now__words"><span class="hatch-now__name">${name}</span> ${state}</span></span><span class="hatch-now__cancel" aria-hidden="true">×</span>` +
              `${h.stalled ? "" : `<span class="hatch-now__bar"><span class="hatch-now__fill"></span></span>`}</button>`
            );
          })
          .join("") + (one.hatcheries.length < 5 ? `<div class="hatch-now hatch-now--more">Build another Hatchery to hatch more at once</div>` : "");
      const slots = [];
      for (let at = 0; at < stacks(); at += 1) {
        const stack = one.queue[at];
        if (!stack) {
          slots.push(`<div class="hatch-slot hatch-slot--empty"><span class="hatch-slot__empty">Empty</span></div>`);
          continue;
        }
        const monster = M[stack[0]];
        slots.push(
          `<button class="hatch-slot" data-act="takeout" data-slot="${at}" type="button" aria-label="${monster.name}: take one out and get its goo back"><span class="hatch-slot__count"></span><span class="hatch-slot__minus" aria-hidden="true">−</span>${face(stack[0], "hatch-slot__picture")}<span class="hatch-slot__name">${monster.name}</span><span class="hatch-slot__note">${monster.timeText} each</span></button>`,
        );
      }
      slotRow.innerHTML =
        slots.join("") +
        `<div class="hatch-line__totals"><span class="hatch-line__done-label">All done in</span>${icon("time", 16, "hatch-line__done-icon")}<span class="hatch-line__done"></span>` +
        `<button type="button" class="hatch-line__boost-link" data-act="boosts" aria-expanded="${S.boosts}" aria-controls="hatch-boosts">${SHINY_ICON}<span class="hatch-line__boost-words">Finish now or speed up</span><span class="hatch-line__boost-words hatch-line__boost-words--short">Speed up</span></button>` +
        `<button type="button" class="btn btn--ghost hatch-clear" data-act="clear" aria-label="Clear all waiting and get the goo back"${one.queue.length ? "" : " disabled"}><span>Clear</span></button></div>`;
    }
    one.hatcheries.forEach((h, index) => {
      const card = nowRow.children[index];
      if (!card || !h.monster || h.stalled) return;
      const time = $(".hatch-clock", card);
      if (time) time.textContent = clock(h.left);
      const fill = $(".hatch-now__fill", card);
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, (1 - h.left / h.total) * 100)).toFixed(1)}%`;
    });
    one.queue.forEach(([, count], at) => {
      const text = $(".hatch-slot__count", slotRow.children[at]);
      if (text) text.textContent = `×${count}`;
    });
    $(".hatch-line__done", slotRow).textContent = one.queue.length || one.hatcheries.some((h) => h.monster) ? clock(doneIn(one)) : "0s";
    drawWarn();
  }

  /* ── Round 3: the Monsters | Presets switch, the preset rows, building one ── */
  const badge = (at) => `<span class="b9r2h-mix__number b9r3h-number">${at + 1}</span>`;
  const scopeIcon = (cls) => (S.level >= 3 ? icon(remote() ? "outpost" : "townhall", 24, cls) : "");

  let warnKey = "";
  /** The housing warning in the switch's row: redrawn only when the number waiting changes. */
  function drawWarn(force) {
    const waiting = yard().hatcheries.filter((h) => h.stalled).length;
    const key = `${S.at}|${waiting}`;
    if (!force && key === warnKey) return;
    warnKey = key;
    $(".b9r3h-warn", tabsRow)?.remove();
    if (!waiting) return;
    tabsRow.insertAdjacentHTML(
      "beforeend",
      `<button class="b9r3h-warn" type="button" data-act="housing" aria-label="Housing is full: ${waiting} hatched monsters wait in the Hatcheries for room">${icon("housing", 24, "b9r3h-warn__icon")}<span class="b9r3h-warn__words">Housing full</span><span class="b9r3h-warn__short">Full</span><span class="b9r3h-warn__count">${waiting} waiting</span><span class="b9r3h-warn__count b9r3h-warn__count--short">×${waiting}</span></button>`,
    );
  }

  function drawTabs() {
    const tab = (id, words, extra = "") =>
      `<button class="b9r3h-tab${S.tab === id ? " b9r3h-tab--on" : ""}" type="button" role="tab" data-act="tab" data-tab="${id}" aria-selected="${S.tab === id}" aria-label="${words}">${extra}<span>${words}</span></button>`;
    if (S.editing === null) {
      editHead.remove();
      // A Send from the quick-send rail, seen from the Monsters tab: what it did is said here.
      const note = S.sent && S.tab === "monsters" && S.sent.scope === scope() ? saidHtml(S.sent, "b9r5h-note", badge(S.sent.slot)) : "";
      tabsRow.innerHTML = `<div class="b9r3h-switch">${tab("monsters", "Monsters")}${tab("presets", "Presets", scopeIcon("b9r3h-tab__scope"))}</div>${note}`;
    } else {
      // While a preset is built, its head takes the switch's place.
      tabsRow.replaceChildren(editHead);
    }
    drawWarn(true);
  }

  /** What a Send did: "Added 60 of 140", and why it stopped or what it skipped. */
  const saidHtml = (sent, cls = "", lead = "") =>
    `<span class="b9r3h-said${sent.why ? " b9r3h-said--short" : ""}${cls ? " " + cls : ""}" role="status">${lead}<strong>${sent.why ? `Added ${num(sent.added)} of ${num(sent.of)}` : `Added ${num(sent.added)}`}</strong><span>${sent.skipped.length ? `${sent.skipped.join(", ")} locked: skipped` : sent.why === "queue" ? "The queue is full" : sent.why === "goo" ? "Not enough goo" : "At the end of the queue"}</span></span>`;
  const stackHtml = ([id, count]) => `<span class="b9r3h-stack">${face(id, "b9r3h-stack__picture")}<span class="b9r3h-stack__count">×${count}</span></span>`;

  /** A strip of stacks that scrolls sideways fades out on the side that has more. */
  const markStrip = (strip) => {
    strip.classList.toggle("b9r5h-more-left", strip.scrollLeft > 2);
    strip.classList.toggle("b9r5h-more-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
  };
  const markStrips = () => {
    for (const strip of list.querySelectorAll(".b9r3h-row__stacks")) markStrip(strip);
  };

  function drawPresets() {
    const here = scope();
    list.dataset.scope = here;
    list.innerHTML = presetList()
      .map((preset, at) => {
        if (!preset.length)
          return `<div class="b9r3h-row b9r3h-row--empty"><button class="b9r3h-row__body" type="button" data-act="preset-edit" data-preset="${at}" aria-label="Make preset ${at + 1}">${badge(at)}<span class="b9r3h-row__plus">+</span></button></div>`;
        const sent = S.sent && S.sent.scope === here && S.sent.slot === at ? S.sent : null;
        // The stacks are beside the button, not in it, so the strip scrolls sideways; a tap on them opens the preset too.
        return (
          `<div class="b9r3h-row"><button class="b9r3h-row__body" type="button" data-act="preset-edit" data-preset="${at}" aria-label="Preset ${at + 1}, ${totalOf(preset)} monsters: change it">${badge(at)}<span class="b9r3h-row__pencil">✎</span></button>` +
          `<span class="b9r3h-stacks b9r3h-row__stacks" data-act="preset-edit" data-preset="${at}" aria-label="Preset ${at + 1}: ${preset.length} stacks in order">${preset.map(stackHtml).join("")}</span>` +
          `<span class="b9r3h-row__cost" data-act="preset-edit" data-preset="${at}">${GOO_ICON}<span>${short(gooOf(preset))}</span></span>` +
          `<button class="btn btn--primary b9r3h-send" type="button" data-act="preset-send" data-preset="${at}" aria-label="Send preset ${at + 1} to the end of the queue">${remote() ? icon("outpost", 24, "b9r2h-addflag") : ""}<span>Send</span></button>${sent ? saidHtml(sent) : ""}</div>`
        );
      })
      .join("");
    markStrips();
    requestAnimationFrame(markStrips);
    drawRail();
  }

  /** The quick-send rail beside the queue (wide screens): one small Send per preset, on either tab. */
  function drawRail() {
    const here = scope();
    rail.className = `b9r5h-rail b9r5h-rail--${slots()}`;
    rail.innerHTML = presetList()
      .map((preset, at) => {
        if (!preset.length)
          return `<div class="b9r5h-quick b9r5h-quick--empty"><button class="b9r5h-quick__body" type="button" data-act="preset-edit" data-preset="${at}" aria-label="Make preset ${at + 1}">${badge(at)}<span class="b9r5h-quick__plus">+</span></button></div>`;
        const sent = S.sent && S.sent.scope === here && S.sent.slot === at;
        return (
          `<div class="b9r5h-quick${sent ? " b9r5h-quick--sent" : ""}"><button class="b9r5h-quick__body" type="button" data-act="tab" data-tab="presets" aria-label="Preset ${at + 1}, ${totalOf(preset)} monsters: open the presets">${badge(at)}<span class="b9r5h-quick__faces">${preset.map(stackHtml).join("")}</span><span class="b9r5h-quick__total">×${totalOf(preset)}</span></button>` +
          `<button class="btn btn--primary b9r3h-send b9r5h-quick__send" type="button" data-act="preset-send" data-preset="${at}" title="Send preset ${at + 1}" aria-label="Send preset ${at + 1} to the end of the queue">${remote() ? icon("outpost", 24, "b9r2h-addflag") : ""}<span class="b9r5h-quick__n">${at + 1} ▸</span><span class="b9r5h-quick__word">Send</span></button></div>`
        );
      })
      .join("");
  }

  /** The last stack when it is `id`'s, else null: the only stack the count works on. */
  const lastOf = (preset, id) => {
    const last = preset[preset.length - 1];
    return last && last[0] === id ? last : null;
  };
  /** The most the stack being counted may hold: a preset is never bigger than the queue's ten stacks. */
  const presetRoom = (preset, id) => Math.max(0, (stacks() - stacksIn(lastOf(preset, id) ? preset.slice(0, -1) : preset)) * stackSize());

  function drawEditor() {
    for (const mark of scroll.querySelectorAll(".b9r3h-inpreset")) mark.remove();
    const at = S.editing;
    if (at === null) return;
    const preset = presetList()[at];
    const mine = lastOf(preset, S.sel);
    const now = mine ? mine[1] : 0;
    const max = presetRoom(preset, S.sel);
    // The preset as the queue's own box grid: one box per queue stack, so the empty boxes are the room that is left.
    const size = stackSize();
    const used = stacksIn(preset);
    const left = stacks() - used;
    const boxes = [];
    preset.forEach(([id, count], index) => {
      const last = index === preset.length - 1;
      for (let rest = count; rest > 0; rest -= size) {
        const holds = Math.min(rest, size);
        const inside = `<span class="hatch-slot__count">×${holds}</span>${face(id, "hatch-slot__picture")}`;
        boxes.push(
          last
            ? `<button class="hatch-slot b9r5h-box b9r5h-box--last${id === S.sel ? " b9r5h-box--on" : ""}" type="button" role="listitem" data-act="chip" data-monster="${id}" aria-label="Box ${boxes.length + 1}, the last stack: ${M[id].name}, ${holds}. Change its count">${inside}${id === S.sel && rest <= size ? `<span class="b9r3h-count-mark">✎</span>` : ""}</button>`
            : `<div class="hatch-slot b9r5h-box" role="listitem" aria-label="Box ${boxes.length + 1}: ${M[id].name}, ${holds}">${inside}</div>`,
        );
      }
    });
    // Another monster is chosen: its stack would start in the next box, shown faint.
    if (preset.length && !mine && max > 0 && !M[S.sel].locked) boxes.push(`<div class="hatch-slot b9r5h-box b9r5h-box--next" aria-hidden="true"><span class="hatch-slot__count">+</span>${face(S.sel, "hatch-slot__picture")}</div>`);
    while (boxes.length < stacks()) boxes.push(`<div class="hatch-slot hatch-slot--empty b9r5h-box" role="listitem" aria-label="Empty box"></div>`);
    editHead.innerHTML =
      `<span class="b9r3h-edit__which">${scopeIcon("b9r3h-edit__scope")}${badge(at)}</span>` +
      `<div class="b9r5h-boxes" role="list" aria-label="Preset ${at + 1}: ${used} of ${stacks()} boxes filled, ${left} left">${boxes.join("")}</div>` +
      `<span class="b9r3h-edit__side"><button class="b9r3h-edit__undo" type="button" data-act="preset-undo" aria-label="Take off the last box"${preset.length ? "" : " disabled"}>${icon("undo", 24)}</button>` +
      `<button class="b9r3h-edit__bin" type="button" data-act="preset-empty" aria-label="Clear preset ${at + 1}"${preset.length ? "" : " disabled"}>Clear</button></span>` +
      `<span class="b9r3h-edit__sum"><span class="b9r3h-edit__stacks${left === 0 ? " b9r3h-edit__stacks--full" : ""}" title="Boxes left of ${stacks()}; each holds up to ${size} monsters." aria-label="${left} of ${stacks()} boxes left; up to ${size} monsters per box"><strong>${left}</strong><span> left</span></span><span class="b9r3h-edit__total" aria-label="${totalOf(preset)} monsters">×${totalOf(preset)}</span><span class="b9r3h-edit__goo">${GOO_ICON}<span>${short(gooOf(preset))}</span></span></span>` +
      `<ol class="b9r3h-edit__words" aria-label="The stacks in the order they are sent">${preset.map(([id, count]) => `<li><span>${M[id].name}</span><strong> ×${count}</strong></li>`).join("")}</ol>` +
      `<button class="btn btn--primary b9r3h-edit__done" type="button" data-act="edit-done" aria-label="Done: back to the presets">Done</button>`;
    // The monsters wear how many of them the preset holds, over all its stacks.
    const totals = new Map();
    for (const [id, count] of preset) totals.set(id, (totals.get(id) || 0) + count);
    for (const [id, count] of totals) $(`.hatch-monster[data-monster="${id}"]`, scroll)?.insertAdjacentHTML("beforeend", `<span class="b9r3h-inpreset" title="Total across all stacks in this preset" aria-label="${count} total across all preset stacks">Σ ${count}</span>`);
    const off = now >= max ? " disabled" : "";
    const active = document.activeElement && document.activeElement.classList.contains("b9r3h-count");
    if (active) return; // typing: the box is left alone, the rest is already drawn
    editBox.innerHTML =
      `<span class="qty-stepper hatch-add__controls"><button type="button" class="btn qty-stepper__step hatch-add__step hatch-add__step--minus" data-by="-1" aria-label="One fewer"${now <= 0 ? " disabled" : ""}>−</button>` +
      `<label class="b9r3h-count-field"><span class="b9r3h-count-mark" aria-hidden="true">${mine ? "✎" : "+"}</span><input type="number" class="field__input qty-stepper__count hatch-add__count b9r3h-count" min="0" max="${max}" step="1" inputmode="numeric" aria-label="${mine ? `How many in the last stack of preset ${at + 1}` : `How many in a new stack at the end of preset ${at + 1}`}" value="${now}"></label>` +
      `<button type="button" class="btn qty-stepper__step hatch-add__step hatch-add__step--plus" data-by="1" aria-label="One more"${off}>+</button>` +
      `<button type="button" class="btn qty-stepper__step qty-stepper__jump hatch-add__jump" data-by="5" aria-label="5 more"${off}>+5</button>` +
      `<button type="button" class="btn qty-stepper__step qty-stepper__jump hatch-add__jump" data-by="10" aria-label="10 more"${off}>+10</button>` +
      `<button type="button" class="btn btn--outline qty-stepper__fill hatch-add__fill" data-by="${stackSize()}" aria-label="One more full stack"${off}>+${stackSize()}</button></span>`;
  }

  /**
   * Sets the count of `id` at the END of the preset being built: the last stack if it is this
   * monster's, else a new stack after it. Earlier stacks are never touched, so the order the
   * stacks were added in is the order they are sent in. 0 takes the last stack off.
   */
  function setPresetCount(id, value) {
    const preset = presetList()[S.editing];
    const mine = lastOf(preset, id);
    const next = Math.max(0, Math.min(Math.floor(Number(value) || 0), presetRoom(preset, id)));
    if (mine) {
      if (next === 0) preset.pop();
      else mine[1] = next;
    } else if (next > 0) preset.push([id, next]);
    drawEditor();
  }

  function drawYards() {
    yardsPage.hidden = !(S.yardsOpen && S.level >= 3);
    if (yardsPage.hidden) return;
    if (!$(".b9r2h-yards__grid", yardsPage)) {
      yardsPage.innerHTML = `<header class="b9r2h-yards__head"><button class="b9r2h-yards__back" type="button" data-act="yards" aria-label="Back">${icon("friendprev", 32, "b9r2h-arrow")}</button><label class="b9r2h-search">${icon("find", 24)}<input class="b9r2h-search__input" aria-label="Find a yard"></label></header><div class="b9r2h-yards__grid"></div>`;
      $(".b9r2h-search__input", yardsPage).value = S.find;
    }
    const words = S.find.trim().toLowerCase();
    const shown = (one) => !words || one.title.toLowerCase().includes(words);
    const cards = [];
    hccYards().forEach((one, at) => {
      if (!shown(one)) return;
      const count = queued(one);
      cards.push(
        `<button class="b9r2h-yardcard${at === S.at ? " b9r2h-yardcard--on" : ""}${count ? "" : " b9r2h-yardcard--idle"}" type="button" data-act="yard" data-yard="${at}" aria-label="${one.title}"><span class="b9r2h-yardcard__top">${icon(one.kind === "main" ? "townhall" : "outpost", 32, "b9r2h-where__icon")}<span class="b9r2h-yardcard__number">${at + 1}</span>${one.pinned ? icon("pin", 16, "b9r2h-yardcard__pin") : ""}</span><span class="b9r2h-yardcard__name">${one.title}</span><span class="b9r2h-yardcard__queue">${icon("time", 16)}<span>${count ? `×${count}` : "0"}</span></span></button>`,
      );
    });
    for (const one of yards.filter((y) => !y.hcc && shown(y))) {
      cards.push(`<button class="b9r2h-yardcard b9r2h-yardcard--off" type="button" aria-label="${one.title}: no HCC" disabled><span class="b9r2h-yardcard__top">${icon("outpost", 32, "b9r2h-where__icon")}${D.lock}</span><span class="b9r2h-yardcard__name">${one.title}</span></button>`);
    }
    $(".b9r2h-yards__grid", yardsPage).innerHTML = cards.join("");
  }

  function drawInfo() {
    const monster = M[S.sel];
    info.setAttribute("aria-label", monster.name);
    info.className = `hatch-info${S.details ? " hatch-info--details" : ""}`;
    info.innerHTML = fix(monster.info);
    info.append(add, editBox);
    const details = $(".hatch-info__details", info);
    if (details) {
      details.dataset.act = "details";
      details.setAttribute("aria-expanded", String(S.details));
    }
    for (const cell of scroll.querySelectorAll(".hatch-monster")) cell.setAttribute("aria-pressed", String(cell.dataset.monster === S.sel));
    drawAdd();
    drawEditor();
  }

  function drawAdd() {
    const one = yard();
    const limits = roomFor(one, S.sel);
    S.count = Math.max(0, Math.min(S.count, limits.fill));
    if (document.activeElement !== addCount || Number(addCount.value) !== S.count) addCount.value = String(S.count);
    addCount.max = String(limits.fill);
    $(".hatch-add__step--minus", add).disabled = S.count <= 0;
    $(".hatch-add__step--plus", add).disabled = S.count >= limits.fill;
    for (const jump of add.querySelectorAll(".hatch-add__jump")) jump.disabled = S.count >= limits.fill;
    addFill.textContent = `Max (${num(limits.fill)})`;
    addFill.disabled = limits.fill <= 0 || S.count >= limits.fill;
    addFill.setAttribute("aria-pressed", String(limits.fill > 0 && S.count >= limits.fill));
    addButton.disabled = S.count <= 0;
    addButton.querySelector(".b9r2h-addflag")?.remove();
    // Remote: Add wears the outpost's flag, so the last tap says where it goes.
    if (remote()) addButton.insertAdjacentHTML("afterbegin", icon("outpost", 24, "b9r2h-addflag"));
    const gate = limits.queue === 0 ? "The shared queue is full." : limits.fill === 0 ? "Not enough goo." : "";
    addGate.hidden = !gate;
    addGate.textContent = gate;
    const space = M[S.sel].space;
    const room = Math.max(0, one.capacity - one.housed - pendingSpace(one));
    const fit = Math.min(S.count, Math.floor(room / space));
    const warn = S.count > 0 && fit < S.count ? `${num(fit)} fit in housing; ${num(S.count - fit)} wait for room` : "";
    addWarning.hidden = !warn;
    addWarning.textContent = warn || " ";
    drawHousing();
  }

  let statusTimer = 0;
  function say(words) {
    status.textContent = words;
    status.hidden = !words;
    clearTimeout(statusTimer);
    if (words) statusTimer = setTimeout(() => (status.hidden = true), 3500);
  }

  function drawAll() {
    drawShell();
    drawStrip();
    drawLines(true);
    drawTabs();
    drawPresets();
    drawYards();
    drawInfo();
  }

  /* ── What a tap does ───────────────────────────────────────────────── */
  const setYard = (at) => {
    S.at = Math.max(0, Math.min(hccYards().length - 1, at));
    S.yardsOpen = false;
    S.editing = null;
    S.sent = null;
    S.count = 0;
    S.find = "";
    yardsPage.replaceChildren();
    drawAll();
  };

  const acts = {
    home: () => setYard(0),
    step: (el) => setYard(S.at + Number(el.dataset.by)),
    yard: (el) => setYard(Number(el.dataset.yard)),
    yards: () => {
      S.yardsOpen = !S.yardsOpen;
      drawYards();
    },
    housing: () => {
      S.showHousing = !S.showHousing;
      drawShell();
    },
    tab: (el) => {
      S.tab = el.dataset.tab;
      S.editing = null;
      drawAll();
    },
    "preset-edit": (el) => {
      // The tab keeps the height it has now, so the window does not jump when the queue is hidden.
      if (!flags.has("live")) hatch.style.minHeight = `${hatch.offsetHeight}px`;
      S.tab = "presets";
      S.editing = Number(el.dataset.preset);
      S.sent = null;
      drawAll();
    },
    "edit-done": () => {
      S.editing = null;
      S.tab = "presets";
      drawAll();
    },
    "preset-empty": () => {
      presetList()[S.editing].length = 0;
      drawEditor();
    },
    "preset-undo": () => {
      // The last box goes: a stack over several boxes loses its last one.
      const preset = presetList()[S.editing];
      const last = preset[preset.length - 1];
      if (last) {
        last[1] -= last[1] % stackSize() || stackSize();
        if (last[1] <= 0) preset.pop();
      }
      drawEditor();
    },
    "preset-send": (el) => {
      send(Number(el.dataset.preset));
      tick(0);
      drawLines(true);
      drawTabs();
      drawPresets();
      drawAdd();
    },
    chip: (el) => {
      S.sel = el.dataset.monster;
      S.count = 0;
      drawInfo();
    },
    boosts: () => {
      S.boosts = !S.boosts;
      drawShell();
      drawLines(true);
    },
    details: () => {
      S.details = !S.details;
      drawInfo();
    },
    clear: () => {
      const one = yard();
      const count = queued(one);
      clearQueue(one);
      say(`Cleared ${num(count)} waiting. Goo back.`);
      drawLines(true);
      drawAdd();
    },
    takeout: (el) => {
      const one = yard();
      const stack = one.queue[Number(el.dataset.slot)];
      if (!stack) return;
      stack[1] -= 1;
      one.goo += M[stack[0]].price;
      if (stack[1] <= 0) one.queue.splice(Number(el.dataset.slot), 1);
      drawLines();
      drawAdd();
    },
    cancel: (el) => {
      const one = yard();
      const h = one.hatcheries[Number(el.dataset.hatchery)];
      if (!h || !h.monster) return;
      one.goo += M[h.monster].price;
      h.monster = null;
      h.stalled = false;
      tick(0);
      drawLines();
      drawAdd();
    },
  };

  const setCount = (value) => {
    S.count = Math.max(0, Math.floor(Number(value) || 0));
    drawAdd();
  };

  frame.addEventListener("click", (event) => {
    const el = event.target.closest("button, [data-act]");
    if (!el || el.disabled) return;
    if (el.dataset.act && acts[el.dataset.act]) return acts[el.dataset.act](el);
    if (el.closest(".b9r3h-set")) {
      if (el.dataset.by === undefined) return undefined;
      // A step counts from the last stack as it stands now (the box may just have been typed in).
      const mine = lastOf(presetList()[S.editing], S.sel);
      return setPresetCount(S.sel, (mine ? mine[1] : 0) + Number(el.dataset.by));
    }
    if (el.classList.contains("hatch-monster")) {
      if (el.classList.contains("hatch-monster--locked")) return say("Rezghul is locked.");
      S.sel = el.dataset.monster;
      S.count = 0;
      return drawInfo();
    }
    if (el.classList.contains("hatch-add__step--minus")) return setCount(S.count - 1);
    if (el.classList.contains("hatch-add__step--plus")) return setCount(S.count + 1);
    if (el.classList.contains("hatch-add__jump")) return setCount(S.count + Number(el.textContent.replace("+", "")));
    if (el.classList.contains("hatch-add__fill")) return setCount(roomFor(yard(), S.sel).fill);
    if (el.classList.contains("hatch-add__add")) {
      const one = yard();
      const asked = S.count;
      const report = addTo(one, S.sel, asked);
      S.count = 0;
      tick(0);
      if (report.added < asked) say(`Added ${num(report.added)} of ${num(asked)} ${plural(M[S.sel].name, asked)} — ${report.stoppedBy === "goo" ? "out of goo" : "the queue is full"}`);
      drawLines();
      drawAdd();
    }
  });
  frame.addEventListener("scroll", (event) => event.target.classList && event.target.classList.contains("b9r3h-row__stacks") && markStrip(event.target), true);
  // A mouse wheel moves a row's stacks sideways (a desktop has no finger to drag them with).
  frame.addEventListener(
    "wheel",
    (event) => {
      const strip = event.target.closest && event.target.closest(".b9r3h-row__stacks");
      if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      const before = strip.scrollLeft;
      strip.scrollLeft += event.deltaY;
      if (strip.scrollLeft !== before) event.preventDefault();
    },
    { passive: false },
  );
  frame.addEventListener("input", (event) => {
    if (event.target === addCount) setCount(addCount.value);
    if (event.target.classList.contains("b9r3h-count")) setPresetCount(S.sel, event.target.value);
    if (event.target.classList.contains("b9r2h-search__input")) {
      S.find = event.target.value;
      drawYards();
    }
  });

  /* ── The page around the frame ─────────────────────────────────────── */
  const SIZES = { phone: [390, 844], desktop: [1280, 720] };
  const stage = $("#stage");
  const frameScale = () => Number(frame.dataset.scale || 1);

  function fit() {
    const [w, h] = SIZES[S.frame];
    const room = BARE ? w : stage.clientWidth;
    const scale = Math.min(1, room / w);
    frame.dataset.scale = String(scale);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    frame.style.transform = `scale(${scale})`;
    const holder = $("#frame-holder");
    holder.style.width = `${Math.floor(w * scale)}px`;
    holder.style.height = `${Math.floor(h * scale)}px`;
  }

  function setFrame() {
    for (const style of document.querySelectorAll("style[data-frame]")) style.disabled = style.dataset.frame !== S.frame;
    document.body.dataset.frame = S.frame;
    $(".demo-backdrop", root).src = asset(`backdrop-${S.frame}`);
    layer.setAttribute("style", D.layerStyle[S.frame] || "");
    panel.setAttribute("style", D.panelStyle[S.frame] || "");
    fit();
    requestAnimationFrame(markStrips);
  }

  const pic = (name) => `<img class="demo-ic" src="${asset(`/ui/icons/${name}-48.webp`)}" alt="">`;
  const NUMBER = `<span class="demo-token demo-token--full">1</span>`;
  const PLUS = `<span class="demo-token">2 <i>+</i></span>`;
  const BUILD = ["Build", `Tap <b>Presets</b>, then the empty slot ${PLUS}. Tap a monster and <b>+10</b>, another and <b>+10</b>, then the first again: each fills the next box. The empty boxes are the room left. <b>Done</b>.`];
  const SEND = ["Send", `Tap <b>Send</b> on a preset ${NUMBER}. It joins the end of the queue. Keep sending: when the queue fills, it says how many fitted.`];
  const CHANGE = ["Change", `Tap a preset's number ✎ to change it: the count works on the last stack, a different monster starts a new box. ${pic("undo")} takes the last box off, <b>Clear</b> empties the slot.`];
  const LONG = ["Long preset", `On <b>Phone</b>, preset <b>3</b> has eight stacks: drag its monsters sideways to see them all. <b>Send</b> and the cost stay put.`];
  const RAIL = ["Quick send", `On <b>Desktop</b>, the small <b>Send</b> buttons beside the queue send a preset from either tab.`];
  const STEPS = {
    1: [BUILD, SEND, CHANGE, RAIL],
    2: [BUILD, SEND, LONG, RAIL],
    3: [BUILD, SEND, LONG, RAIL, ["Outposts", `${pic("friendnext")} steps to an outpost ${pic("outpost")}: gold frame, and <b>Presets</b> ${pic("outpost")} is now the list shared by all outposts. ${pic("townhall")} goes home to the main yard's list.`]],
  };
  const LEVELS = {
    1: ["Level 1", "7 queue boxes of 20", "<b>2</b> presets", "this yard only"],
    2: ["Level 2", "10 queue boxes of 20", "<b>4</b> presets", "this yard only"],
    3: ["Level 3", "10 queue boxes of 30", "<b>6</b> presets, plus 6 shared by all outposts", "runs every outpost from home"],
  };

  function drawChrome() {
    for (const button of document.querySelectorAll("#demo [data-set]")) {
      const [key, value] = button.dataset.set.split("=");
      button.setAttribute("aria-pressed", String(String(S[key]) === value));
    }
    const steps = STEPS[S.level];
    $("#demo-steps").innerHTML = steps.map(([name, words], at) => `<li><span class="demo-step__n">${at + 1}</span><span><strong>${name}</strong> ${words}</span></li>`).join("");
    $("#demo-option").textContent = `Level ${S.level}`;
    $("#demo-levels").innerHTML = [1, 2, 3]
      .map((level) => {
        const [name, ...has] = LEVELS[level];
        return `<button type="button" class="demo-level" data-set="level=${level}" aria-pressed="${S.level === level}"><strong>${name}</strong>${has.map((line) => `<span>${line}</span>`).join("")}</button>`;
      })
      .join("");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#demo [data-set], #demo [data-reset]");
    if (!button) return;
    if (button.dataset.set) {
      const [key, value] = button.dataset.set.split("=");
      const next = key === "level" ? Number(value) : value;
      if (S[key] === next) return;
      S[key] = next;
      if (key === "level") reset(); // each level has its own queue, stack size and preset slots
      if (key === "frame") setFrame();
    } else {
      flags.clear();
      reset();
      yardsPage.replaceChildren();
    }
    drawChrome();
    drawAll();
  });

  document.documentElement.style.fontSize = "15px"; // the game's rem base, whatever the host page says
  if (BARE) document.body.classList.add("demo-bare");
  reset();
  setFrame();
  drawChrome();
  drawAll();
  window.addEventListener("resize", fit);
  if (!PAUSED) {
    setInterval(() => {
      tick((SPEED * TICK_MS) / 1000);
      drawLines();
      drawHousing();
      if (document.activeElement !== addCount) drawAdd();
    }, TICK_MS);
  }
})();
