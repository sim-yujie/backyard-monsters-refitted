import type { AllianceResult, AllianceType, MyAlliance } from "@/api/alliance";
import type { ConstellationView, GoalView, NewsLine, TerritoryRow } from "@/api/allianceProgress";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { make } from "@/ui/friends/rows";

/**
 * The alliance dashboard's phase 2 parts (design v5 §7b, §8, §9a, §11): the
 * Overview's stat tiles, Today, Goals, Top helpers and news cards, the
 * Constellation tab and the Territory tab. Pure DOM builders; the window
 * (`AllianceWindow.ts`) owns the state and the calls.
 */

/** What a part needs from the window. */
export interface ProgressHost {
  /** Runs a call, shows a refusal, and reloads the alliance on success. */
  run(action: () => Promise<AllianceResult<object>>): void;
  /** Redraws the window (after a local choice). */
  redraw(): void;
  /** Unix seconds now. */
  now(): number;
}

/** A stat's words and painted icon. */
export const STAT_INFO: Readonly<Record<string, { readonly label: string; readonly icon: GameIconName; readonly cells?: boolean }>> = {
  production: { label: "Resources made", icon: "production" },
  loot: { label: "Loot carried home", icon: "resourcebomb" },
  outpostHatchCost: { label: "Outpost hatch cost", icon: "housing" },
  takeoverCost: { label: "Takeover cost", icon: "pin" },
  kitCost: { label: "Starter Kit cost", icon: "box2" },
  reach: { label: "Flinger reach", icon: "range", cells: true },
  outpostHealth: { label: "Outpost health", icon: "health" },
  buildingHealth: { label: "Building health", icon: "health" },
  trapDamage: { label: "Trap damage", icon: "damage" },
  towerDamage: { label: "Tower damage", icon: "damage" },
};

/** "+15%", "−10%", "+1" (reach in cells). */
export const statValue = (stat: string, value: number): string => {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const amount = Math.abs(Math.round(value * 10) / 10);
  return `${sign}${amount}${STAT_INFO[stat]?.cells ? "" : "%"}`;
};

const button = (words: string, className: string, run: () => void, title?: string): HTMLButtonElement => {
  const node = make("button", `btn ${className}`, words);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", () => run());
  return node;
};

const card = (title: string, ...children: HTMLElement[]): HTMLElement => {
  const box = make("section", "alliance-card");
  box.append(make("h3", "alliance-card__title", title), ...children);
  return box;
};

const canLead = (alliance: MyAlliance): boolean => alliance.role === "leader" || alliance.role === "officer";

/** Points left to spend on stars. */
export const pointsToSpend = (alliance: MyAlliance): number => Math.max(0, alliance.points - alliance.points_spent);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** The four stat tiles: the type's 2 strengths and 2 weaknesses, values now. */
export const statTiles = (alliance: MyAlliance): HTMLElement | null => {
  const list = alliance.constellations ?? [];
  if (list.length === 0) return null;
  const row = make("div", "alliance-stats");
  for (const c of list) {
    const effect = c.effects[0];
    if (!effect) continue;
    const info = STAT_INFO[effect.stat];
    const tile = make("div", `alliance-stat alliance-stat--${c.kind}`);
    const value = statValue(effect.stat, effect.values[c.steps] ?? 0);
    tile.title = `${c.name}: ${info?.label ?? effect.stat}`;
    tile.setAttribute("aria-label", `${info?.label ?? effect.stat} ${value} (${c.kind === "strength" ? "strength" : "weakness"})`);
    tile.append(
      make("span", "alliance-stat__arrow", c.kind === "strength" ? "▲" : "▼"),
      gameIcon(info?.icon ?? "empire", { size: 24, decorative: true }),
      make("strong", "alliance-stat__value", value),
      make("span", "alliance-stat__label", info?.label ?? effect.stat),
    );
    row.append(tile);
  }
  return row;
};

/** "9 of 12 members helped today", with a dot per member, points today and to spend. */
export const todayCard = (alliance: MyAlliance): HTMLElement | null => {
  const today = alliance.today;
  if (!today) return null;
  const dots = make("div", "alliance-today__dots");
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < today.members; i++) {
    dots.append(make("span", `alliance-today__dot${i < today.contributed ? " alliance-today__dot--on" : ""}`));
  }
  const numbers = make("div", "alliance-today__numbers");
  numbers.append(
    make("span", "alliance-today__line", `${today.contributed} of ${today.members} members helped today`),
    make("span", "alliance-today__chip", `+${formatAmount(today.points_today)} today`),
    make("span", "alliance-today__chip alliance-today__chip--spend", `★ ${formatAmount(pointsToSpend(alliance))} to spend`),
  );
  return card("Today", dots, numbers);
};

const tierWord = (tier: GoalView["tier"]): string => tier.charAt(0).toUpperCase() + tier.slice(1);

/** The week's goals, with Add and Remove for the Leader and Officers. */
export const goalsCard = (
  alliance: MyAlliance,
  host: ProgressHost,
  api: { setGoal(kind: string, tier: GoalView["tier"]): Promise<AllianceResult<object>>; removeGoal(id: number): Promise<AllianceResult<object>> },
  adding: { open: boolean; toggle(): void },
): HTMLElement | null => {
  const goals = alliance.goals;
  if (!goals) return null;
  const lead = canLead(alliance);
  const list = make("div", "alliance-goals");
  if (goals.length === 0) list.append(make("p", "alliance-goals__empty", lead ? "No goals yet this week. Add up to 5." : "No goals yet this week."));
  for (const goal of goals) {
    const row = make("div", `alliance-goal${goal.done ? " alliance-goal--done" : ""}`);
    const bar = make("div", "alliance-goal__bar");
    const fill = make("span", "alliance-goal__fill");
    fill.style.width = `${Math.min(100, Math.round((goal.progress / Math.max(1, goal.target)) * 100))}%`;
    bar.append(fill);
    const head = make("div", "alliance-goal__head");
    head.append(
      make("span", "alliance-goal__name", goal.name),
      make("span", `alliance-goal__tier alliance-goal__tier--${goal.tier}`, tierWord(goal.tier)),
      make("span", "alliance-goal__points", goal.done ? `✓ +${formatAmount(goal.points)}` : `★ ${formatAmount(goal.points)}`),
    );
    row.append(head, bar, make("span", "alliance-goal__count", `${formatAmount(goal.progress)} / ${formatAmount(goal.target)}`));
    if (lead && goal.removable && !goal.done) {
      row.append(button("Remove", "btn--outline btn--small alliance-goal__remove", () => host.run(() => api.removeGoal(goal.id))));
    }
    list.append(row);
  }
  const children: HTMLElement[] = [list];
  const endsIn = (alliance.week_ends_at ?? 0) - host.now();
  if (endsIn > 0) children.push(make("p", "alliance-goals__ends", `Week ends in ${formatCountdown(endsIn)}`));
  const room = (alliance.goals_per_week ?? 5) - goals.length;
  if (lead && room > 0) {
    children.push(button(adding.open ? "Close" : "Add goal", "btn--outline alliance-goals__add", () => adding.toggle()));
    if (adding.open) {
      const taken = new Set(goals.map((g) => g.kind));
      const menu = make("div", "alliance-goal-menu");
      for (const item of alliance.goal_menu ?? []) {
        if (taken.has(item.kind)) continue;
        const line = make("div", "alliance-goal-menu__row");
        line.append(make("span", `alliance-goal-menu__name${item.only ? " alliance-goal-menu__name--only" : ""}`, item.name));
        for (const tier of item.tiers) {
          const pick = button(
            `${tierWord(tier.tier)} ${formatAmount(tier.target)}`,
            `btn--outline btn--small alliance-goal-menu__tier alliance-goal-menu__tier--${tier.tier}`,
            () => host.run(() => api.setGoal(item.kind, tier.tier)),
            `★ ${tier.points}`,
          );
          line.append(pick);
        }
        menu.append(line);
      }
      children.push(menu);
    }
  }
  return card(`Goals ${goals.length}/${alliance.goals_per_week ?? 5}`, ...children);
};

/** This week's top 3 helpers. */
export const helpersCard = (alliance: MyAlliance): HTMLElement | null => {
  const helpers = alliance.top_helpers ?? [];
  if (helpers.length === 0) return null;
  const list = make("ol", "alliance-helpers");
  for (const helper of helpers) {
    const row = make("li", "alliance-helpers__row");
    row.append(
      make("span", "alliance-helpers__name", helper.username),
      make("span", "alliance-helpers__stat", `${helper.quests} quests`),
      make("span", "alliance-helpers__stat", `${helper.goal_share}% of a goal`),
    );
    list.append(row);
  }
  return card("Top helpers this week", list);
};

const ago = (ts: number, now: number): string => {
  const seconds = Math.max(0, now - Math.floor(ts / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

/** The feed card: the latest lines, and All news to see them all. */
export const newsCard = (lines: readonly NewsLine[] | null, all: boolean, host: ProgressHost, toggle: () => void): HTMLElement => {
  const list = make("ul", "alliance-news");
  const shown = all ? (lines ?? []) : (lines ?? []).slice(0, 3);
  if (lines === null) list.append(make("li", "alliance-news__empty", "Loading…"));
  else if (shown.length === 0) list.append(make("li", "alliance-news__empty", "Nothing yet."));
  for (const line of shown) {
    const row = make("li", `alliance-news__row alliance-news__row--${line.type}`);
    row.append(make("span", "alliance-news__text", line.text), make("span", "alliance-news__when", ago(line.ts, host.now())));
    list.append(row);
  }
  const box = card("News", list);
  if ((lines?.length ?? 0) > 3 || all) box.append(button(all ? "Less" : "All news", "btn--outline alliance-news__all", toggle));
  return box;
};

// ---------------------------------------------------------------------------
// Constellation tab (design v5 §9a; star figures are placeholders)
// ---------------------------------------------------------------------------

/** Ten star places per figure (a 200 x 170 box), one layout per slot: placeholder art. */
const FIGURES: readonly (readonly [number, number][])[] = [
  [[30, 120], [55, 95], [80, 105], [100, 75], [125, 60], [150, 70], [170, 45], [140, 100], [115, 125], [85, 140]],
  [[25, 60], [50, 45], [80, 55], [100, 85], [95, 120], [125, 130], [150, 110], [170, 80], [155, 50], [120, 35]],
  [[40, 40], [65, 65], [60, 100], [85, 125], [115, 115], [140, 130], [165, 105], [150, 75], [120, 70], [100, 40]],
  [[30, 90], [55, 70], [85, 80], [110, 55], [140, 45], [165, 65], [150, 95], [125, 110], [95, 130], [65, 125]],
];

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** One figure: 10 stars, lit ones gold, the next 2 ringed with the price on the first. */
const figure = (c: ConstellationView, slot: number): SVGSVGElement => {
  const places = FIGURES[slot % FIGURES.length]!;
  const lit = c.steps * 2;
  const box = svg("svg", { viewBox: "0 0 200 170", class: "alliance-sky__figure", "aria-hidden": "true" });
  for (let i = 1; i < places.length; i++) {
    const [x1, y1] = places[i - 1]!;
    const [x2, y2] = places[i]!;
    box.append(svg("line", { x1, y1, x2, y2, class: `alliance-sky__line${i < lit ? " alliance-sky__line--lit" : ""}` }));
  }
  places.forEach(([x, y], i) => {
    const state = i < lit ? "lit" : i < lit + 2 && c.next_price !== null ? "next" : "dim";
    if (state === "next") box.append(svg("circle", { cx: x, cy: y, r: 9, class: "alliance-sky__ring" }));
    box.append(svg("circle", { cx: x, cy: y, r: state === "lit" ? 5 : 3.5, class: `alliance-sky__star alliance-sky__star--${state}` }));
  });
  if (c.next_price !== null) {
    const [x, y] = places[lit]!;
    const tag = svg("g", { class: "alliance-sky__tag" });
    // Clear of the figure: above the star, or below when it is near the top.
    const ty = y < 30 ? y + 22 : y - 16;
    tag.append(svg("rect", { x: x - 22, y: ty - 11, width: 44, height: 18, rx: 9 }));
    const text = svg("text", { x, y: ty + 2, "text-anchor": "middle" });
    text.textContent = `★${c.next_price}`;
    tag.append(text);
    box.append(tag);
  }
  return box;
};

/** 5 columns of 2 dots: the stars lit. */
const starDots = (steps: number): HTMLElement => {
  const dots = make("span", "alliance-dots");
  dots.setAttribute("aria-label", `${steps * 2} of 10 stars`);
  for (let s = 0; s < 5; s++) {
    const col = make("span", "alliance-dots__col");
    col.append(make("span", `alliance-dots__dot${s < steps ? " alliance-dots__dot--on" : ""}`), make("span", `alliance-dots__dot${s < steps ? " alliance-dots__dot--on" : ""}`));
    dots.append(col);
  }
  return dots;
};

/** The constellation chosen: the given one, else the first not yet full. */
export const chosenConstellation = (list: readonly ConstellationView[], id: string | null): ConstellationView | null =>
  list.find((c) => c.id === id) ?? list.find((c) => c.next_price !== null) ?? list[0] ?? null;

/** The Constellation tab. */
export const constellationTab = (
  alliance: MyAlliance,
  host: ProgressHost,
  api: { lightStar(id: string): Promise<AllianceResult<object>>; suggestStar(id: string): Promise<AllianceResult<object>> },
  chosenId: string | null,
  choose: (id: string) => void,
): HTMLElement[] => {
  const list = alliance.constellations ?? [];
  if (list.length === 0) return [make("p", "alliance-sky__empty", "The constellations are not ready yet.")];
  const chosen = chosenConstellation(list, chosenId)!;
  const litStars = list.reduce((sum, c) => sum + c.steps * 2, 0);

  const sky = make("div", `alliance-sky alliance-sky--${alliance.type}`);
  const top = make("div", "alliance-sky__top");
  const groups = make("span", "alliance-sky__groups");
  for (const c of list) groups.append(starDots(c.steps));
  top.append(
    make("span", "alliance-sky__count", `★ ${litStars} / ${list.length * 10}`),
    groups,
    make("span", "alliance-sky__points", `${formatAmount(pointsToSpend(alliance))} points to spend`),
  );
  sky.append(top);

  const halves = make("div", "alliance-sky__halves");
  (["strength", "weakness"] as const).forEach((kind) => {
    const half = make("div", `alliance-sky__half alliance-sky__half--${kind}`);
    half.append(make("span", "alliance-sky__label", kind === "strength" ? "▲ Strengths grow" : "▼ Weaknesses shrink"));
    const row = make("div", "alliance-sky__row");
    list.forEach((c, slot) => {
      if (c.kind !== kind) return;
      const node = make("button", `alliance-sky__con${c.id === chosen.id ? " alliance-sky__con--chosen" : ""}${c.next_price === null ? " alliance-sky__con--full" : ""}`);
      node.type = "button";
      node.setAttribute("aria-pressed", String(c.id === chosen.id));
      node.addEventListener("click", () => choose(c.id));
      const effect = c.effects[0];
      const plate = make("span", `alliance-sky__plate alliance-sky__plate--${kind}`);
      plate.append(
        make("span", "alliance-sky__name", c.name),
        starDots(c.steps),
        make("span", "alliance-sky__value", effect ? statValue(effect.stat, effect.values[c.steps] ?? 0) : ""),
      );
      node.append(figure(c, slot), plate);
      row.append(node);
    });
    half.append(row);
    halves.append(half);
  });
  sky.append(halves, make("span", "alliance-sky__placeholder", "Placeholder star art"));
  return [sky, detailBar(alliance, chosen, host, api)];
};

/** The detail bar: what the chosen one does, its star track, and Light or Suggest. */
const detailBar = (
  alliance: MyAlliance,
  c: ConstellationView,
  host: ProgressHost,
  api: { lightStar(id: string): Promise<AllianceResult<object>>; suggestStar(id: string): Promise<AllianceResult<object>> },
): HTMLElement => {
  const bar = make("div", `alliance-detail alliance-detail--${c.kind}`);
  const effect = c.effects[0];
  const info = effect ? STAT_INFO[effect.stat] : undefined;
  const who = make("div", "alliance-detail__who");
  const per = effect && effect.values.length > 1 ? effect.values[1]! - effect.values[0]! : 0;
  who.append(
    make("strong", "alliance-detail__name", c.name),
    make("span", `alliance-detail__tag alliance-detail__tag--${c.kind}`, c.kind === "strength" ? "Strength" : "Weakness"),
    make("span", "alliance-detail__stat", info?.label ?? ""),
    make("span", "alliance-detail__per", effect ? `${statValue(effect.stat, per)} per 2 stars` : ""),
  );
  if (info) who.prepend(gameIcon(info.icon, { size: 32, decorative: true }));

  // The star track: start, then 5 pairs; lit gold, the next one tagged.
  const track = make("ol", "alliance-track");
  (effect?.values ?? []).forEach((value, i) => {
    const state = i === c.steps ? "now" : i < c.steps ? "lit" : i === c.steps + 1 ? "next" : "later";
    const mark = make("li", `alliance-track__mark alliance-track__mark--${state}`);
    mark.title = i === 0 ? "Start" : `Stars ${i * 2 - 1}–${i * 2}, ★${c.prices[i - 1] ?? ""}`;
    mark.append(
      make("span", "alliance-track__pip", i === 0 ? "●" : state === "next" ? `★${c.next_price}` : "★★"),
      make("span", "alliance-track__value", statValue(effect!.stat, value)),
    );
    track.append(mark);
  });

  const act = make("div", "alliance-detail__act");
  const toSpend = pointsToSpend(alliance);
  if (c.next_price === null) {
    act.append(make("span", "alliance-detail__full", "★ All 10 lit"));
  } else {
    if (effect) {
      act.append(
        make(
          "span",
          "alliance-detail__gain",
          `${statValue(effect.stat, effect.values[c.steps] ?? 0)} → ${statValue(effect.stat, effect.values[c.steps + 1] ?? 0)}`,
        ),
      );
    }
    const stars = `★${c.steps * 2 + 1}–${c.steps * 2 + 2}`;
    if (canLead(alliance)) {
      const light = button(`Light ${stars}`, "btn--primary alliance-detail__light", () => host.run(() => api.lightStar(c.id)));
      light.disabled = toSpend < c.next_price;
      act.append(light);
      if (toSpend < c.next_price) {
        const need = make("div", "alliance-detail__need");
        const fill = make("span", "alliance-detail__need-fill");
        fill.style.width = `${Math.round((toSpend / c.next_price) * 100)}%`;
        need.append(fill, make("span", "alliance-detail__need-words", `${toSpend} / ${c.next_price}, need ${c.next_price - toSpend}`));
        act.append(need);
      }
      if (c.suggest_count > 0) act.append(make("span", "alliance-detail__suggests", `${c.suggest_count} mates suggest this`));
    } else {
      const mine = alliance.my_suggestion === c.id;
      const suggest = button(mine ? "Suggested" : "Suggest", "btn--outline alliance-detail__suggest", () => host.run(() => api.suggestStar(c.id)));
      suggest.disabled = mine;
      act.append(suggest, make("span", "alliance-detail__who-lights", `Leader and Officers light stars · ${c.suggest_count} suggest`));
    }
  }
  bar.append(who, track, act);
  const last = alliance.last_lit;
  if (last?.id) {
    const name = (alliance.constellations ?? []).find((x) => x.id === last.id)?.name ?? last.id;
    bar.append(
      make("p", "alliance-detail__last", `Last lit: ${name} ★${last.step * 2 - 1}–${last.step * 2}, by ${last.by}, ${ago(last.at * 1000, host.now())} ago`),
    );
  }
  return bar;
};

// ---------------------------------------------------------------------------
// Territory tab (design v5 §11)
// ---------------------------------------------------------------------------

const TYPE_WORD: Record<AllianceType, string> = { midas: "Midas' Council", conquest: "Conquest Horde", fortress: "Fortress Legion" };

/** The Territory tab: one board per type, this month and all time. */
export const territoryTab = (
  alliance: MyAlliance,
  shown: AllianceType,
  rows: readonly TerritoryRow[] | null,
  pick: (type: AllianceType) => void,
  shieldUrl: (image: number) => string,
): HTMLElement[] => {
  const switcher = make("div", "alliance-board__types");
  switcher.setAttribute("role", "tablist");
  for (const type of ["midas", "conquest", "fortress"] as const) {
    const node = button(TYPE_WORD[type], `btn--outline btn--small alliance-board__type${type === shown ? " alliance-board__type--on" : ""}`, () => pick(type));
    node.setAttribute("aria-selected", String(type === shown));
    switcher.append(node);
  }
  const nodes: HTMLElement[] = [switcher];
  const mine = alliance.territory;
  if (mine && shown === alliance.type) {
    nodes.push(make("p", "alliance-board__mine", `Your rank: #${mine.rank} of ${mine.of} · ${formatAmount(mine.month)} outpost-days this month`));
  }
  nodes.push(make("p", "alliance-board__rule", "1 point per outpost held by a member, each day."));
  const table = make("table", "alliance-board");
  const head = make("tr", "alliance-board__head");
  for (const words of ["#", "Alliance", "Month", "All time"]) head.append(make("th", "", words));
  table.append(head);
  if (rows === null) {
    const tr = make("tr", "");
    const td = make("td", "alliance-board__empty", "Loading…");
    td.colSpan = 4;
    tr.append(td);
    table.append(tr);
  } else if (rows.length === 0) {
    const tr = make("tr", "");
    const td = make("td", "alliance-board__empty", "No alliances of this type yet.");
    td.colSpan = 4;
    tr.append(td);
    table.append(tr);
  }
  for (const row of rows ?? []) {
    const tr = make("tr", `alliance-board__row${row.alliance_id === alliance.alliance_id ? " alliance-board__row--mine" : ""}`);
    const name = make("td", "alliance-board__name");
    const img = make("img", "alliance-board__shield");
    img.src = shieldUrl(row.image);
    img.alt = "";
    name.append(img, make("span", "", row.name));
    if (row.badge) name.append(make("span", `alliance-board__badge alliance-board__badge--${row.badge}`, `#${row.badge} last month`));
    tr.append(make("td", "alliance-board__rank", String(row.rank)), name, make("td", "", formatAmount(row.month)), make("td", "", formatAmount(row.all_time)));
    table.append(tr);
  }
  nodes.push(table);
  return nodes;
};
