/*
 * HCC Level 2/3 demo: options D "workbench" and E "monster book".
 * A stand-alone copy of the design prototype on design/b9-screens-r2 (web/src/proto/b9HccR2.ts):
 * the window, the Hatch tab and the prototype's parts are the game's own markup and CSS; this file
 * only plays the game's part (a pretend yard, queue and timers). Demo data, nothing is saved.
 *
 * Build: tools/prep.mjs (game captures -> build/), then tools/build.mjs (-> index.html). Check: tools/shots.mjs.
 * Address options after "#", joined with "&": opt=d|e, level=2|3, frame=phone|desktop,
 * state=busy,remote,mix,yards,inspect,housing (the prototype's picture states), bare (frame only, 1:1),
 * paused (clock stopped), load=replace (Load clears the queue first; the default adds).
 */
(() => {
  "use strict";
  const D = window.HCC_DATA;
  const ASSETS = window.HCC_ASSETS || {};
  const M = D.monsters;

  /* ── Choices the prototype never wired (the owner has not decided these) ── */
  /** What Load does: "add" = adds the mix to the queue like Add does; "replace" = clears the queue first. */
  let LOAD_MODE = "add";
  const MIX_SLOTS = 5;
  const STACKS = 10;
  /** Game seconds that pass per real second. */
  const SPEED = 10;
  const TICK_MS = 500;

  const hash = new Map(location.hash.replace(/^#/, "").split("&").filter(Boolean).map((p) => p.split("=").map(decodeURIComponent)));
  const flags = new Set((hash.get("state") || "").split(",").filter(Boolean));
  if (hash.get("load") === "replace") LOAD_MODE = "replace";
  const BARE = hash.has("bare");
  const PAUSED = hash.has("paused");

  const S = {
    opt: hash.get("opt") === "e" ? "e" : "d",
    level: hash.get("level") === "3" ? 3 : 2,
    frame: hash.get("frame") === "desktop" ? "desktop" : "phone",
    at: 0, // index into the yards that have an HCC; 0 = home
    sel: "C1",
    count: 0,
    mixOpen: null,
    yardsOpen: false,
    inspect: false,
    showHousing: false,
    details: false,
    boosts: false,
    find: "",
  };
  let yards = [];
  let mixes = { home: [], outpost: [] };

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
      home.queue = stacksOf([["C12", size - 1], ["C12", size], ["C8", size], ["C8", size], ["C7", size], ["C14", size], ["C5", size], ["C3", size], ["C1", size], ["C6", Math.round(size / 2)]]);
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
    mixes = {
      home: [
        [["C8", 60], ["C7", 40], ["C1", 40]],
        [["C12", 40], ["C5", 40], ["C10", 20]],
        [["C14", 40], ["C13", 60], ["C3", 40], ["C6", 20]],
        [["C6", 100], ["C9", 40]],
        null,
      ],
      outpost: [[["C7", 60], ["C2", 40]], [["C1", 60]], null, null, null],
    };
    S.at = 0;
    S.count = 0;
    S.mixOpen = null;
    S.yardsOpen = false;
    S.inspect = false;
    S.showHousing = false;
    S.boosts = false;
    S.find = "";
    if (S.level >= 3 && flags.has("remote")) S.at = 1;
    if (flags.has("mix")) S.mixOpen = 0;
    if (S.level >= 3 && flags.has("yards")) S.yardsOpen = true;
    if (S.opt === "e" && flags.has("inspect")) S.inspect = true;
    if (flags.has("housing")) S.showHousing = true;
  }

  const hccYards = () => yards.filter((one) => one.hcc);
  const yard = () => hccYards()[S.at] || yards[0];
  const remote = () => S.at > 0;
  const mixList = () => (remote() ? mixes.outpost : mixes.home);
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
    if (queue.length >= STACKS) return false;
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
    const queue = (STACKS - one.queue.length) * stackSize() + inLast;
    return { queue, fill: Math.max(0, Math.min(queue, Math.floor(one.goo / M[id].price))) };
  };
  const clearQueue = (one) => {
    for (const [id, count] of one.queue) one.goo += count * M[id].price;
    one.queue = [];
  };

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
  const mixCard = $(".b9r2h-mixcard", hatch);
  const yardsPage = $(".b9r2h-yards", hatch);

  // The scroll area, built once; the prototype moves the line into or out of the bench per option.
  scroll.innerHTML =
    `<div class="b9r2h-bench"></div>` +
    `<div class="hatch-boosts" id="hatch-boosts" hidden>${fix(D.boosts)}</div>` +
    `<div class="hatch__split"><div class="hatch-message"></div><section class="hatch-pick" aria-label="Monsters">${fix(D.grid)}</section><section class="hatch-info"></section></div>`;
  const bench = $(".b9r2h-bench", scroll);
  const boosts = $(".hatch-boosts", scroll);
  const message = $(".hatch-message", scroll);
  const info = $(".hatch-info", scroll);
  const lines = document.createElement("section");
  lines.className = "hatch-lines";
  lines.setAttribute("aria-label", "Hatching line");
  lines.innerHTML = `<div class="hatch-line hatch-line--hcc"><div class="hatch-line__now" role="group" aria-label="Hatching now"></div><div class="hatch-line__slots" role="group" aria-label="Waiting"></div></div>`;
  const nowRow = $(".hatch-line__now", lines);
  const slotRow = $(".hatch-line__slots", lines);
  const mixRow = document.createElement("div");
  mixRow.className = "b9r2h-mixes";
  mixRow.setAttribute("role", "group");
  mixRow.setAttribute("aria-label", "Saved mixes");
  const seal = document.createElement("button");
  seal.type = "button";
  seal.className = "b9r2h-seal";
  seal.dataset.act = "inspect";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "b9r2h-back";
  back.dataset.act = "back";
  back.setAttribute("aria-label", "Back to the monsters");
  back.innerHTML = icon("friendprev", 32, "b9r2h-arrow");
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
    hatch.className = `hatch b9r2h b9r2h-opt-${S.opt} b9r2h-level-${S.level}${remote() ? " b9r2h-remote" : ""}${S.inspect && S.opt === "e" ? " b9r2h-inspect" : ""}${S.showHousing ? " b9r2h-show-housing" : ""}`;
    if (S.opt === "e") {
      bench.replaceChildren(seal, mixRow);
      bench.after(back, lines);
    } else {
      back.remove();
      bench.replaceChildren(lines, mixRow);
    }
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
      if (S.opt === "d") {
        const of = hccYards().length;
        parts.push(
          `<div class="b9r2h-stepper"><button class="b9r2h-stepper__arrow" type="button" data-act="step" data-by="-1" aria-label="Previous yard"${S.at <= 0 ? " disabled" : ""}>${icon("friendprev", 32, "b9r2h-arrow")}</button>` +
            `<button class="b9r2h-stepper__where" type="button" data-act="yards" aria-label="All your yards with an HCC">${where()}</button>` +
            `<button class="b9r2h-stepper__arrow" type="button" data-act="step" data-by="1" aria-label="Next yard"${S.at >= of - 1 ? " disabled" : ""}>${icon("friendnext", 32, "b9r2h-arrow")}</button></div>`,
        );
      } else {
        parts.push(`<button class="b9r2h-yard b9r2h-yard--chip" type="button" data-act="yards" aria-label="Choose a yard">${where()}<span class="b9r2h-caret">▾</span></button>`);
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
      for (let at = 0; at < STACKS; at += 1) {
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
    drawSeal(force);
  }

  let sealKey = "";
  function drawSeal(force) {
    if (S.opt !== "e") return;
    const one = yard();
    const busy = one.hatcheries.filter((h) => h.monster).length;
    const stalled = one.hatcheries.some((h) => h.stalled);
    const faces = [];
    for (const [id] of one.queue) if (!faces.includes(id) && faces.length < 4) faces.push(id);
    const key = `${S.at}|${busy}|${stalled}|${faces.join(",")}|${one.queue.length}`;
    if (force || key !== sealKey) {
      sealKey = key;
      seal.setAttribute("aria-label", stalled ? "Housing full: inspect the queue and waiting hatcheries" : "The queue and the hatcheries");
      seal.innerHTML =
        `<span class="b9r2h-seal__part${stalled ? " b9r2h-seal__part--stalled" : ""}"><img class="b9r2h-seal__hatchery" src="${asset("/assets/buildings/hatchery/top.3d3@2x.webp")}" alt=""><span class="b9r2h-seal__number">${busy}/${one.hatcheries.length}${stalled ? `<span class="b9r2h-seal__state">Full</span>` : ""}</span>${stalled ? icon("housing", 24, "b9r2h-seal__blocked") : ""}</span>` +
        `<span class="b9r2h-seal__part b9r2h-seal__part--queue"><span class="b9r2h-faces">${faces.map((id) => face(id, "b9r2h-face")).join("")}</span><span class="b9r2h-seal__number">${one.queue.length}/${STACKS}</span></span>` +
        `<span class="b9r2h-seal__part">${icon("time", 24, "b9r2h-seal__clock")}<span class="b9r2h-seal__number b9r2h-seal__time"></span></span><span class="b9r2h-seal__go">›</span>`;
    }
    $(".b9r2h-seal__time", seal).textContent = $(".hatch-line__done", slotRow).textContent;
  }

  function drawMixes() {
    mixRow.innerHTML = mixList()
      .map((mix, at) => {
        if (!mix) return `<button class="b9r2h-mix b9r2h-mix--empty" type="button" data-act="mix-save" data-mix="${at}" aria-label="Save the queue as mix ${at + 1}"><span class="b9r2h-mix__number">${at + 1}</span><span class="b9r2h-mix__plus">+</span></button>`;
        const total = mix.reduce((sum, [, count]) => sum + count, 0);
        return `<button class="b9r2h-mix${S.mixOpen === at ? " b9r2h-mix--on" : ""}" type="button" data-act="mix-open" data-mix="${at}" aria-label="Mix ${at + 1}, ${total} monsters"><span class="b9r2h-mix__number">${at + 1}</span><span class="b9r2h-faces">${mix.slice(0, 3).map(([id]) => face(id, "b9r2h-face")).join("")}</span><span class="b9r2h-mix__total">×${total}</span></button>`;
      })
      .join("");
    drawMixCard();
  }

  function drawMixCard() {
    const mix = S.mixOpen === null ? null : mixList()[S.mixOpen];
    mixCard.hidden = !mix;
    if (!mix) return;
    let goo = 0;
    let space = 0;
    const stacks = mix
      .map(([id, count]) => {
        goo += count * M[id].price;
        space += count * M[id].space;
        return `<span class="b9r2h-socket">${face(id, "b9r2h-socket__picture")}<span class="b9r2h-socket__count">×${count}</span></span>`;
      })
      .join("");
    mixCard.innerHTML =
      `<header class="b9r2h-mixcard__head"><span class="b9r2h-mix__number b9r2h-mixcard__number">${S.mixOpen + 1}</span><span class="b9r2h-mixcard__cost">${GOO_ICON}<span>${short(goo)}</span>${icon("housing", 24, "b9r2h-housing__icon")}<span>${short(space)}</span></span><button class="b9r2h-mixcard__close" type="button" data-act="mix-close" aria-label="Close">✕</button></header>` +
      `<div class="b9r2h-mixcard__stacks">${stacks}</div>` +
      `<div class="b9r2h-mixcard__actions"><button class="btn btn--primary b9r2h-mixcard__load" type="button" data-act="mix-load" aria-label="Load this mix into the queue">Load</button><button class="btn btn--secondary b9r2h-mixcard__tool" type="button" data-act="mix-over" aria-label="Save the queue over this mix">${icon("lastarmy", 24)}Save over</button><button class="btn btn--ghost b9r2h-mixcard__tool b9r2h-mixcard__bin" type="button" data-act="mix-empty" aria-label="Empty this mix">Empty</button></div>`;
    placeMixCard();
  }

  /** As the prototype: under the tokens, wherever the option put them; on a wide tab under its own tokens. */
  function placeMixCard() {
    if (mixCard.hidden) return;
    const scale = frameScale();
    const tokens = mixRow.getBoundingClientRect();
    const box = hatch.getBoundingClientRect();
    const width = box.width / scale;
    mixCard.style.top = `${Math.round((tokens.bottom - box.top) / scale + 6)}px`;
    mixCard.style.left = width > 620 ? `${Math.round(Math.max(12, Math.min((tokens.left - box.left) / scale, width - 420)))}px` : "";
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
    info.append(add);
    const details = $(".hatch-info__details", info);
    if (details) {
      details.dataset.act = "details";
      details.setAttribute("aria-expanded", String(S.details));
    }
    for (const cell of scroll.querySelectorAll(".hatch-monster")) cell.setAttribute("aria-pressed", String(cell.dataset.monster === S.sel));
    drawAdd();
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
    drawMixes();
    drawYards();
    drawInfo();
    placeMixCard();
  }

  /* ── What a tap does ───────────────────────────────────────────────── */
  const snapshot = (one) => {
    const mix = [];
    for (const [id, count] of one.queue) {
      const same = mix.find(([seen]) => seen === id);
      if (same) same[1] += count;
      else mix.push([id, count]);
    }
    return mix;
  };
  const setYard = (at) => {
    S.at = Math.max(0, Math.min(hccYards().length - 1, at));
    S.yardsOpen = false;
    S.mixOpen = null;
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
      S.mixOpen = null;
      drawMixes();
      drawYards();
    },
    housing: () => {
      S.showHousing = !S.showHousing;
      drawShell();
    },
    inspect: () => {
      S.inspect = true;
      S.mixOpen = null;
      drawShell();
      drawMixes();
    },
    back: () => {
      S.inspect = false;
      S.mixOpen = null;
      drawShell();
      drawMixes();
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
    "mix-open": (el) => {
      const at = Number(el.dataset.mix);
      S.mixOpen = S.mixOpen === at ? null : at;
      drawMixes();
    },
    "mix-close": () => {
      S.mixOpen = null;
      drawMixes();
    },
    "mix-save": (el) => {
      const one = yard();
      if (!one.queue.length) return say("The queue is empty: nothing to save.");
      mixList()[Number(el.dataset.mix)] = snapshot(one);
      say(`Queue saved as mix ${Number(el.dataset.mix) + 1}.`);
      drawMixes();
    },
    "mix-over": () => {
      const one = yard();
      if (!one.queue.length) return say("The queue is empty: nothing to save.");
      mixList()[S.mixOpen] = snapshot(one);
      say(`Queue saved over mix ${S.mixOpen + 1}.`);
      drawMixes();
    },
    "mix-empty": () => {
      mixList()[S.mixOpen] = null;
      S.mixOpen = null;
      drawMixes();
    },
    "mix-load": () => {
      const one = yard();
      const mix = mixList()[S.mixOpen];
      if (!mix) return;
      if (LOAD_MODE === "replace") clearQueue(one);
      let added = 0;
      let asked = 0;
      let stoppedBy = null;
      for (const [id, count] of mix) {
        asked += count;
        if (stoppedBy) continue;
        const report = addTo(one, id, count);
        added += report.added;
        stoppedBy = report.stoppedBy;
      }
      const at = S.mixOpen + 1;
      S.mixOpen = null;
      tick(0);
      if (added === 0) say(stoppedBy === "goo" ? "Not enough goo." : "The shared queue is full.");
      else if (stoppedBy) say(`Mix ${at}: added ${num(added)} of ${num(asked)} — ${stoppedBy === "goo" ? "out of goo" : "the queue is full"}`);
      else say(`Mix ${at} loaded: ${num(added)} monsters.`);
      drawLines(true);
      drawMixes();
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
  frame.addEventListener("input", (event) => {
    if (event.target === addCount) setCount(addCount.value);
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
    placeMixCard();
  }

  function setFrame() {
    for (const style of document.querySelectorAll("style[data-frame]")) style.disabled = style.dataset.frame !== S.frame;
    document.body.dataset.frame = S.frame;
    $(".demo-backdrop", root).src = asset(`backdrop-${S.frame}`);
    layer.setAttribute("style", D.layerStyle[S.frame] || "");
    panel.setAttribute("style", D.panelStyle[S.frame] || "");
    fit();
  }

  const pic = (name) => `<img class="demo-ic" src="${asset(`/ui/icons/${name}-48.webp`)}" alt="">`;
  const TOKEN = `<span class="demo-token">5 <i>+</i></span>`;
  const NUMBER = `<span class="demo-token demo-token--full">1</span>`;
  const ADD = `Tap a monster, <b>+10</b>, <b>Add</b>.`;
  const STEPS = {
    d2: [["Add", `${ADD} It lands in the rack of ten stacks.`], ["Save", `Tap the empty token ${TOKEN}. The queue is now mix 5.`], ["Load", `Tap <b>Clear</b>, then a token ${NUMBER} and <b>Load</b>.`]],
    e2: [["Add", `${ADD} The bar on top counts it.`], ["Queue", `Tap the bar to open the queue. ${pic("friendprev")} goes back.`], ["Mix", `Tap ${TOKEN} to save the queue. Tap a token ${NUMBER}, then <b>Load</b>.`]],
    d3: [["Add", `${ADD} It lands in the rack of ten stacks.`], ["Mix", `Tap ${TOKEN} to save the queue. Tap a token ${NUMBER}, then <b>Load</b>.`], ["Outposts", `${pic("friendprev")}${pic("friendnext")} step to an outpost ${pic("outpost")}: gold frame, flag on Add. ${pic("townhall")} goes home. The middle opens the list.`]],
    e3: [["Add", `${ADD} The bar on top counts it; tap it to open the queue.`], ["Mix", `Tap ${TOKEN} to save the queue. Tap a token ${NUMBER}, then <b>Load</b>.`], ["Outposts", `Tap ${pic("townhall")}<b>1/11</b> and pick an outpost ${pic("outpost")}: gold frame, flag on Add. ${pic("townhall")} goes home.`]],
  };

  function drawChrome() {
    for (const button of document.querySelectorAll("#demo [data-set]")) {
      const [key, value] = button.dataset.set.split("=");
      button.setAttribute("aria-pressed", String(String(S[key]) === value));
    }
    const steps = STEPS[`${S.opt}${S.level}`];
    $("#demo-steps").innerHTML = steps.map(([name, words], at) => `<li><span class="demo-step__n">${at + 1}</span><span><strong>${name}</strong> ${words}</span></li>`).join("");
    $("#demo-option").textContent = S.opt === "d" ? "D · Workbench" : "E · Monster book";
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#demo [data-set], #demo [data-reset]");
    if (!button) return;
    if (button.dataset.set) {
      const [key, value] = button.dataset.set.split("=");
      const next = key === "level" ? Number(value) : value;
      if (S[key] === next) return;
      S[key] = next;
      if (key === "level") reset(); // the stacks hold 20 at level 2 and 30 at level 3
      if (key === "opt") {
        S.inspect = false;
        S.mixOpen = null;
        S.yardsOpen = false;
        yardsPage.replaceChildren();
      }
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
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeMixCard());
  if (!PAUSED) {
    setInterval(() => {
      tick((SPEED * TICK_MS) / 1000);
      drawLines();
      drawHousing();
      if (document.activeElement !== addCount) drawAdd();
    }, TICK_MS);
  }
})();
