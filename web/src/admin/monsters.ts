import {
  fetchMonsterStats,
  type ChampionOwnership,
  type ChampionScope,
  type MonsterCount,
  type MonsterPeriod,
  type MonsterSide,
  type MonsterStats,
  type TribeCount,
} from "./api";
import { chart, type ChartPoint } from "./charts";
import { h, replace, svg, type Child } from "./dom";
import { count, dayLabel, plural } from "./format";

/**
 * The Monsters tab of Game activity (owner, 23 Nov 2026; layout A "Balance
 * sheet", `worktrees/mon-stats-ux/proto/mon-stats/d1-balance-sheet.html`):
 * which monsters players fling, on players and on camps apart, as one ranked
 * list (a row opens its levels and puts its own line in the chart); which
 * camps they attack, per tribe and camp level; and which champions they own.
 *
 * Its own period (7 days, 30 days, All time), apart from the Players tab's.
 * Counting began with patch 8.3, so the first days say how many days there
 * are. Numbers come from `GET /admin/stats/monsters`
 * (`server/src/services/stats/monsterUsageStats.ts`).
 */

type Mode = "players" | "camps";
type Kind = "all" | "normal" | "inferno";
type Sort = "flung" | "share" | "players" | "roster";
type ChampScope = "active" | "every";

const PERIODS: readonly [MonsterPeriod, string][] = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["all", "All time"],
];

const CHAMPION_NAMES: Readonly<Record<string, string>> = {
  G1: "Gorgo",
  G2: "Drull",
  G3: "Fomor",
  G4: "Korath",
  G5: "Krallen",
};

/** "34%", "<1%", "0%". */
export const share = (part: number, whole: number): string => {
  if (!(whole > 0) || part <= 0) return "0%";
  const p = (part / whole) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/** "in the first day", "in the last 30 days", "in all 45 days so far"; "so far" before anything is counted. */
export const periodWords = (period: MonsterPeriod, span: number): string =>
  span <= 0
    ? "so far"
    : span === 1
      ? "in the first day"
      : period === "all"
        ? `in all ${plural(span, "day")} so far`
        : `in the last ${plural(span, "day")}`;

/** The line under the heading: since when monsters are counted. */
export const countingWords = (stats: Pick<MonsterStats, "since" | "daysCounted">): string => {
  if (!stats.since) return "Monster counts start with the first attack after update 8.3.";
  const base = `Monster counts since ${dayLabel(stats.since)} · ${plural(stats.daysCounted, "day")} so far`;
  if (stats.daysCounted <= 7) return `${base} · every period shows the same days for now`;
  if (stats.daysCounted < 30) return `${base} · 30 days and All time show the same days for now`;
  return base;
};

/** The painted portrait the game shows in its lists (`web/src/game/portraits.ts`). */
const face = (file: string, size: number): HTMLImageElement =>
  h("img", {
    class: "mon-face",
    attrs: {
      src: `${import.meta.env.BASE_URL}portraits/${file}-icon.webp`,
      width: String(size),
      height: String(size),
      alt: "",
      decoding: "async",
    },
  });

const championFile = (id: string): string => (id === "G5" ? "G5" : `${id}-L6`);

const segmented = (
  label: string,
  options: readonly (readonly [string, string])[],
  current: string,
  pick: (value: string) => void,
  extra = "",
): HTMLElement =>
  h(
    "div",
    { class: `segmented${extra ? ` ${extra}` : ""}`, attrs: { role: "group", "aria-label": label } },
    ...options.map(([value, text]) =>
      h("button", { class: "seg", attrs: { type: "button", "aria-pressed": String(value === current) }, onClick: () => pick(value) }, text),
    ),
  );

const panel = (title: string, right: Child, ...children: Child[]): HTMLElement =>
  h(
    "section",
    { class: "panel activity-panel" },
    h("div", { class: "activity-head" }, h("h2", { class: "section-title" }, title), right),
    ...children,
  );

/** The pie of owned champions: five fixed colours, the total in the middle. */
const pie = (slices: readonly { name: string; count: number }[], size = 168): SVGSVGElement => {
  const r = size / 2;
  const inner = r * 0.56;
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const root = svg("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    class: "pie",
    role: "img",
    "aria-label": slices.map((slice) => `${slice.name} ${share(slice.count, total)}`).join(", "),
  });
  let angle = -Math.PI / 2;
  const at = (radius: number, a: number) => `${r + radius * Math.cos(a)} ${r + radius * Math.sin(a)}`;
  slices.forEach((slice, index) => {
    if (!total || !slice.count) return;
    const sweep = Math.min((slice.count / total) * Math.PI * 2, Math.PI * 2 - 1e-4);
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const path = svg("path", {
      d: `M${at(r, angle)} A${r} ${r} 0 ${large} 1 ${at(r, end)} L${at(inner, end)} A${inner} ${inner} 0 ${large} 0 ${at(inner, angle)} Z`,
      class: `slice cat-${index + 1}`,
    });
    const title = svg("title");
    title.textContent = `${slice.name}: ${count(slice.count)} (${share(slice.count, total)})`;
    path.append(title);
    root.append(path);
    angle = end;
  });
  if (!total) root.append(svg("circle", { cx: r, cy: r, r: (r + inner) / 2, class: "pie-empty", "stroke-width": r - inner }));
  const big = svg("text", { x: r, y: r - 2, "text-anchor": "middle", class: "pie-total" });
  big.textContent = count(total);
  const small = svg("text", { x: r, y: r + 16, "text-anchor": "middle", class: "pie-sub" });
  small.textContent = total === 1 ? "champion" : "champions";
  root.append(big, small);
  return root;
};

/** The levels a camp chart shows: a Map Room 2 tribe's real ones, the Descent's 13, else the attacked span. */
export const campLevels = (tribe: TribeCount): number[] => {
  if (tribe.only?.length) return tribe.only;
  if (!tribe.range) return [];
  const [low, high] = tribe.range;
  if (tribe.where === "Descent") return Array.from({ length: high - low + 1 }, (_, i) => low + i);
  const hit = tribe.levels.map((level) => level.level).filter((level) => level >= low && level <= high);
  if (!hit.length) return [];
  const from = Math.min(...hit);
  const to = Math.max(...hit);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};

const SHORT_WHERE: Readonly<Record<TribeCount["where"], string>> = {
  "Map Room 1": "MR1",
  "Map Room 2": "MR2",
  Inferno: "Inferno",
  Descent: "Inferno",
};

export class MonstersView {
  /** The tab's insides. */
  readonly element = h("div", { class: "mon-tab" });
  /** The 7 days / 30 days / All time picker, for the page's heading. */
  readonly picker = h("div", { class: "mon-period" });
  /** The line under the heading: since when monsters are counted. */
  readonly counting = h("p", { class: "counting-line" });

  private period: MonsterPeriod = "30";
  private mode: Mode = "players";
  private kind: Kind = "all";
  private sort: Sort = "flung";
  private find = "";
  /** The monster whose own line the chart shows, and the row that is open. */
  private pinned = "";
  private open = "";
  private tribe = "";
  private champ: ChampScope = "active";

  private stats: MonsterStats | null = null;
  private champions: ChampionOwnership | null = null;
  private loading: Promise<void> | null = null;
  private failed: string | null = null;
  /** The ranked list's rows, redrawn alone while the owner types in Find. */
  private list: HTMLElement | null = null;

  constructor() {
    this.renderPicker();
    replace(this.element, h("p", { class: "small" }, "Loading the monster counts…"));
  }

  /** Loads the numbers the first time the tab is opened. */
  show(): Promise<void> {
    if (this.stats || this.loading) return this.loading ?? Promise.resolve();
    return this.refresh();
  }

  /** Loads the numbers again (the page's Refresh), if the tab was ever opened. */
  reload(): Promise<void> {
    return this.stats || this.failed ? this.refresh() : Promise.resolve();
  }

  private refresh(): Promise<void> {
    const period = this.period;
    this.element.classList.add("is-loading");
    this.loading = fetchMonsterStats(period)
      .then((answer) => {
        if (period !== this.period) return;
        this.stats = answer.stats;
        this.champions = answer.champions;
        this.failed = null;
      })
      .catch((err: unknown) => {
        this.failed = String(err);
      })
      .finally(() => {
        this.loading = null;
        this.element.classList.remove("is-loading");
        this.render();
      });
    return this.loading;
  }

  private renderPicker(): void {
    replace(
      this.picker,
      segmented("How far back", PERIODS, this.period, (value) => {
        if (value === this.period) return;
        this.period = value as MonsterPeriod;
        this.renderPicker();
        void this.refresh();
      }),
    );
  }

  private set(change: () => void): void {
    change();
    this.render();
  }

  render(): void {
    const stats = this.stats;
    if (!stats) {
      replace(this.counting);
      replace(
        this.element,
        h("p", { class: this.failed ? "notice bad" : "small" }, this.failed ? `The monster counts could not be loaded: ${this.failed}` : "Loading the monster counts…"),
      );
      return;
    }
    replace(this.counting, countingWords(stats));
    replace(
      this.element,
      this.failed ? h("p", { class: "notice bad" }, `Not updated: ${this.failed}`) : null,
      this.monstersPanel(stats),
      this.campsPanel(stats),
      this.championsPanel(),
    );
  }

  // ---- Monsters flung ----

  private side(stats: MonsterStats): MonsterSide {
    return this.mode === "players" ? stats.players : stats.camps;
  }

  private monstersPanel(stats: MonsterStats): HTMLElement {
    const side = this.side(stats);
    const span = stats.days.length;
    const words = periodWords(stats.period, span);
    const pinned = side.monsters.find((monster) => monster.id === this.pinned) ?? null;
    const modeSwitch = segmented(
      "Whose yards",
      [
        ["players", "On players"],
        ["camps", "On camps"],
      ],
      this.mode,
      (value) => this.set(() => {
        this.mode = value as Mode;
        this.pinned = "";
        this.open = "";
      }),
    );
    const summary = h(
      "p",
      { class: "small" },
      `${plural(side.attacks, this.mode === "players" ? "attack on players" : "attack on camps", this.mode === "players" ? "attacks on players" : "attacks on camps")} by ${plural(side.players, "player")} ${words}`,
      this.mode === "camps" ? " · Repeat attacks included" : "",
    );

    const values = pinned ? pinned.daily : side.daily;
    const points: ChartPoint[] = stats.days.map((day, index) => ({ day, value: values[index] ?? 0 }));
    const unit = pinned ? `${pinned.name} flung` : "monsters flung";
    const trend = h(
      "article",
      { class: "chart-card trend-card" },
      h(
        "header",
        { class: "chart-head" },
        h("h3", {}, pinned ? `${pinned.name} flung each day` : "Monsters flung each day"),
        h("p", { class: "chart-summary" }, `${count(pinned ? pinned.flung : side.flung)} ${words}`),
        pinned
          ? h(
              "button",
              {
                class: "pinned-chip",
                attrs: { type: "button", "aria-label": `Show all monsters again, not only ${pinned.name}` },
                onClick: () => this.set(() => (this.pinned = "")),
              },
              face(pinned.id, 24),
              `${pinned.name} ✕`,
            )
          : null,
      ),
      points.length
        ? chart(points, { kind: points.length < 3 ? "bar" : "line", unit, ...(points.length < 3 && { barMax: 48 }) })
        : h("p", { class: "empty-state" }, "Nothing counted yet: the first attack after update 8.3 starts the chart."),
      points.length && points.length < 3 ? h("p", { class: "drawer-note" }, "The line starts once 3 days are counted; until then each day is a bar.") : null,
    );

    const tools = h(
      "div",
      { class: "toolbar-row" },
      segmented(
        "Which monsters",
        [
          ["all", `All ${side.monsters.length}`],
          ["normal", `Normal ${side.monsters.filter((m) => m.kind === "normal").length}`],
          ["inferno", `Inferno ${side.monsters.filter((m) => m.kind === "inferno").length}`],
        ],
        this.kind,
        (value) => this.set(() => (this.kind = value as Kind)),
        "small-seg",
      ),
      segmented(
        "Sort by",
        (
          [
            ["flung", "Flung"],
            ["share", "% atk"],
            ["players", "Players"],
          ] as const
        ).map(([key, text]) => [key, (this.sort === key || (key === "flung" && this.sort === "roster")) ? `${text} ↓` : text] as const),
        this.sort === "roster" ? "flung" : this.sort,
        (value) => this.set(() => (this.sort = value as Sort)),
        "small-seg phone-only",
      ),
      h("span", { class: "grow" }),
      this.findInput(),
    );

    this.list = h("div", { class: "mlist", attrs: { role: "table", "aria-label": "Monsters flung" } });
    this.fillList(side);

    return panel(
      "Monsters flung",
      h("div", { class: "head-tools" }, modeSwitch),
      summary,
      trend,
      tools,
      this.list,
      this.notCounted(stats),
    );
  }

  private findInput(): HTMLInputElement {
    const input = h("input", {
      class: "input",
      attrs: { type: "search", placeholder: "Find a monster", "aria-label": "Find a monster", value: this.find },
    });
    input.value = this.find;
    input.addEventListener("input", () => {
      this.find = input.value;
      if (this.stats) this.fillList(this.side(this.stats));
    });
    return input;
  }

  private fillList(side: MonsterSide): void {
    if (!this.list) return;
    const sorters: Record<Sort, (a: MonsterCount, b: MonsterCount) => number> = {
      flung: (a, b) => b.flung - a.flung,
      share: (a, b) => b.attacks - a.attacks,
      players: (a, b) => b.players - a.players,
      roster: () => 0,
    };
    const find = this.find.trim().toLowerCase();
    const list = side.monsters
      .filter((monster) => this.kind === "all" || monster.kind === this.kind)
      .filter((monster) => !find || monster.name.toLowerCase().includes(find))
      .sort(sorters[this.sort]);
    const most = Math.max(1, ...side.monsters.map((monster) => monster.flung));
    const topLevel = Math.max(...side.monsters.map((monster) => monster.maxLevel));
    const sortButton = (key: Sort, text: string) =>
      h(
        "button",
        { attrs: { type: "button", "aria-pressed": String(this.sort === key) }, onClick: () => this.set(() => (this.sort = key)) },
        text,
      );
    const head = h(
      "div",
      { class: "mlist-head", attrs: { role: "row" } },
      h("span", {}),
      sortButton("roster", "Monster"),
      sortButton("flung", "Flung"),
      h("span", { class: "r" }, sortButton("share", "In attacks")),
      h("span", { class: "r" }, sortButton("players", "Players")),
      h("span", {}, `Level 1 → ${topLevel}`),
      h("span", {}),
    );
    const rows = list.map((monster) => this.row(monster, side, most));
    replace(this.list, head, ...(rows.length ? rows : [h("p", { class: "empty-state" }, "No monster matches.")]));
  }

  private row(monster: MonsterCount, side: MonsterSide, most: number): HTMLElement {
    const open = this.open === monster.id;
    const top = Math.max(1, ...monster.levels.map((level) => level.flung));
    const inferno = monster.kind === "inferno";
    const main = h(
      "button",
      {
        class: "mrow-main",
        attrs: { type: "button", "aria-expanded": String(open) },
        onClick: () =>
          this.set(() => {
            this.open = open ? "" : monster.id;
            this.pinned = open ? this.pinned : monster.id;
          }),
      },
      face(monster.id, 36),
      h("span", { class: "mname" }, monster.name, inferno ? h("span", { class: "badge" }, "Inferno") : null),
      h(
        "span",
        { class: "mbar" },
        h("strong", {}, count(monster.flung)),
        h("span", { class: "track" }, h("span", { class: "fill", attrs: { style: `width:${(monster.flung / most) * 100}%` } })),
      ),
      h("span", { class: "flungv" }, count(monster.flung)),
      h("span", { class: "r c-share num" }, share(monster.attacks, side.attacks)),
      h("span", { class: "r c-players num" }, count(monster.players)),
      h(
        "span",
        { class: "mix", attrs: { title: `Monsters flung at each level, 1 to ${monster.maxLevel}` } },
        ...monster.levels.map((level) =>
          h("i", {
            class: level.flung ? "" : "zero",
            attrs: { style: `height:${level.flung ? Math.max(8, (level.flung / top) * 100) : 8}%` },
          }),
        ),
      ),
      h(
        "span",
        { class: "meta" },
        `${inferno ? "Inferno · " : ""}${share(monster.attacks, side.attacks)} atk · ${plural(monster.players, "player")}`,
      ),
      h("span", { class: "chev", attrs: { "aria-hidden": "true" } }, "›"),
    );
    const row = h(
      "div",
      { class: "mrow", attrs: { ...(open ? { "data-open": "" } : {}), ...(monster.flung ? {} : { "data-zero": "" }) } },
      main,
    );
    if (open) {
      row.append(
        h(
          "div",
          { class: "mdrawer" },
          this.wideLevels(monster, side),
          this.tallLevels(monster, side),
          h("p", { class: "drawer-note" }, `Chart above: ${monster.name} only · % atk = share of attacks with it at that level`),
        ),
      );
    }
    return row;
  }

  private wideLevels(monster: MonsterCount, side: MonsterSide): HTMLElement {
    return h(
      "div",
      { class: "table-wrap levels-wide" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", { attrs: { scope: "col" } }, "Level"), ...monster.levels.map((l) => h("th", { attrs: { scope: "col" } }, `L${l.level}`)))),
        h(
          "tbody",
          {},
          h("tr", {}, h("th", { attrs: { scope: "row" } }, "Flung"), ...monster.levels.map((l) => h("td", { class: l.flung ? "" : "dim" }, count(l.flung)))),
          h("tr", {}, h("th", { attrs: { scope: "row" } }, "In attacks"), ...monster.levels.map((l) => h("td", {}, share(l.attacks, side.attacks)))),
          h("tr", {}, h("th", { attrs: { scope: "row" } }, "Players"), ...monster.levels.map((l) => h("td", {}, count(l.players)))),
        ),
      ),
    );
  }

  private tallLevels(monster: MonsterCount, side: MonsterSide): HTMLElement {
    return h(
      "div",
      { class: "table-wrap levels-tall" },
      h(
        "table",
        {},
        h("colgroup", {}, h("col", { class: "c-lv" }), h("col", { class: "c-flung" }), h("col", { class: "c-pct" }), h("col", {})),
        h("thead", {}, h("tr", {}, ...["Lv", "Flung", "% atk", "Players"].map((text) => h("th", { attrs: { scope: "col" } }, text)))),
        h(
          "tbody",
          {},
          ...monster.levels.map((l) =>
            h(
              "tr",
              {},
              h("th", { attrs: { scope: "row" } }, `L${l.level}`),
              h("td", { class: l.flung ? "" : "dim" }, count(l.flung)),
              h("td", {}, share(l.attacks, side.attacks)),
              h("td", {}, count(l.players)),
            ),
          ),
        ),
      ),
    );
  }

  /** What the list leaves out, as it really is. */
  private notCounted(stats: MonsterStats): HTMLElement {
    const lines: Child[] = [
      `Not counted: attacks before ${stats.since ? dayLabel(stats.since) : "update 8.3"}, test accounts, and Map Room 3 (switched off). Champions are below; bombs are not monsters.`,
    ];
    if (this.mode === "camps") {
      lines.push(h("br"), "Camps are Map Room 1 and 2 wild monsters, Moloch tribes and the Descent's 13 yards; Repeat attacks included.");
    }
    if (this.mode === "players" && stats.assumed > 0) {
      lines.push(h("br"), `${plural(stats.assumed, "Inferno attack")} counted as whole army, not shown.`);
    }
    if (stats.unreplayed > 0) {
      lines.push(h("br"), `${plural(stats.unreplayed, "attack")} landed with no battle the server could fight: their monsters are counted from the fling log.`);
    }
    return h("p", { class: "not-counted small" }, h("span", { class: "nc-icon", attrs: { "aria-hidden": "true" } }, "i"), h("span", {}, ...lines));
  }

  // ---- Camp attacks ----

  private campsPanel(stats: MonsterStats): HTMLElement {
    const camps = stats.camps;
    const words = periodWords(stats.period, stats.days.length);
    const tribes = camps.tribes.filter((tribe) => tribe.attacks > 0 || tribe.key !== "mr1:practice");
    const busiest = [...tribes].sort((a, b) => b.attacks - a.attacks)[0];
    const pick = tribes.find((tribe) => tribe.key === this.tribe) ?? busiest;
    const pills = h(
      "div",
      { class: "pill-row", attrs: { role: "group", "aria-label": "Tribe" } },
      ...tribes.map((tribe) =>
        h(
          "button",
          {
            class: "tribe-pill",
            attrs: { type: "button", "aria-pressed": String(tribe === pick), ...(tribe.attacks ? {} : { "data-zero": "" }) },
            onClick: () => this.set(() => (this.tribe = tribe.key)),
          },
          tribe.name,
          h("small", {}, `${SHORT_WHERE[tribe.where]} · ${count(tribe.attacks)}`),
        ),
      ),
    );
    const card = pick ? this.tribeCard(pick, words) : null;
    const table = h(
      "details",
      { class: "tech" },
      h("summary", {}, "Every tribe and level as numbers"),
      h(
        "div",
        { class: "tech-body" },
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "data-table" },
            h(
              "thead",
              {},
              h("tr", {}, ...["Tribe", "Camp level", "Attacks", "Players"].map((text) => h("th", { attrs: { scope: "col" } }, text))),
            ),
            h(
              "tbody",
              {},
              ...tribes.flatMap((tribe) =>
                (tribe.levels.length ? tribe.levels : tribe.attacks ? [{ level: null, attacks: tribe.attacks, players: tribe.players }] : []).map((level) =>
                  h(
                    "tr",
                    {},
                    h("th", { attrs: { scope: "row" } }, `${tribe.name} · ${tribe.where}`),
                    h("td", {}, level.level === null ? "–" : String(level.level)),
                    h("td", {}, count(level.attacks)),
                    h("td", {}, count(level.players)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return panel(
      "Camp attacks",
      h("span", { class: "small" }, "Repeat attacks included"),
      h("p", { class: "small" }, `${plural(camps.attacks, "attack")} on wild monster camps by ${plural(camps.players, "player")} ${words}`),
      pills,
      card,
      camps.attacks ? table : null,
    );
  }

  private tribeCard(tribe: TribeCount, words: string): HTMLElement {
    const levels = campLevels(tribe);
    const at = new Map(tribe.levels.map((level) => [level.level, level]));
    const points: ChartPoint[] = levels.map((level) => ({ day: String(level), value: at.get(level)?.attacks ?? 0 }));
    const players = (point: ChartPoint) => at.get(Number(point.day))?.players ?? 0;
    const peak = points.reduce((best, point, index) => ((point.value ?? 0) > (points[best]?.value ?? 0) ? index : best), 0);
    const range = tribe.only?.length
      ? `Camps at levels ${tribe.only.join(", ")} only`
      : tribe.range
        ? `Camp levels ${tribe.range[0]}–${tribe.range[1]}${levels.length && tribe.where !== "Descent" ? `; ${levels[0]}–${levels[levels.length - 1]} shown` : ""}`
        : "The practice camp has no level";
    const label = tribe.where === "Descent" ? "Yard" : "Level";
    return h(
      "article",
      { class: "chart-card trend-card" },
      h(
        "header",
        { class: "chart-head" },
        h("h3", {}, `${tribe.name} (${tribe.where}) by ${tribe.where === "Descent" ? "yard" : "camp level"}`),
        h("p", { class: "chart-summary" }, `${plural(tribe.attacks, "attack")} by ${plural(tribe.players, "player")} ${words}`),
      ),
      tribe.attacks && points.length
        ? chart(points, {
            kind: "bar",
            unit: "attacks",
            start: peak,
            barMax: 40,
            axis: (point) => `${tribe.where === "Descent" ? "Yard" : "Lv"} ${point.day}`,
            when: (point) => `${label} ${point.day}`,
            say: (point) => `${plural(point.value ?? 0, "attack")} · ${plural(players(point), "player")}`,
          })
        : h("p", { class: "empty-state" }, tribe.attacks ? `${plural(tribe.attacks, "attack")} by ${plural(tribe.players, "player")}` : "No attacks on this tribe yet."),
      h("p", { class: "drawer-note" }, range),
    );
  }

  // ---- Champions ----

  private championsPanel(): HTMLElement | null {
    const all = this.champions;
    if (!all) return null;
    const scope: ChampionScope = all[this.champ];
    const total = scope.owned.reduce((sum, one) => sum + one.count, 0);
    const slices = scope.owned.map((one) => ({ id: one.id, name: CHAMPION_NAMES[one.id] ?? one.id, count: one.count }));
    const legend = h(
      "ul",
      { class: "legend" },
      ...slices.map((slice, index) =>
        h(
          "li",
          {},
          h("span", { class: `sw cat-${index + 1}` }),
          face(championFile(slice.id), 28),
          h("span", {}, slice.name),
          h("span", { class: "n" }, count(slice.count)),
          h("span", { class: "p" }, share(slice.count, total)),
        ),
      ),
    );
    const owners = scope.players - scope.none;
    const none = h(
      "div",
      { class: "nochamp" },
      h("strong", {}, count(scope.none)),
      h("span", {}, `players with no champion · ${share(scope.none, scope.players)} of ${count(scope.players)}`),
      h(
        "p",
        { class: "owns" },
        owners
          ? `${count(owners)} own 1 or more: ${scope.byCount.map((n, i) => `${count(n)} own ${i + 1}`).join(" · ")}`
          : "Nobody owns a champion.",
      ),
    );
    return panel(
      "Champions owned",
      h(
        "div",
        { class: "head-tools" },
        segmented(
          "Which players",
          [
            ["active", "Active 30 days"],
            ["every", "Every account"],
          ],
          this.champ,
          (value) => this.set(() => (this.champ = value as ChampScope)),
        ),
      ),
      h(
        "p",
        { class: "snapshot" },
        this.champ === "active"
          ? "Real players seen in the last 30 days, their yards right now (the period does not change it) · share of owned champions"
          : "Every real player's account (test accounts left out), their yards right now · share of owned champions",
      ),
      h("div", { class: "champ" }, pie(slices), legend, none),
    );
  }
}
