import {
  fetchAttackLog,
  searchPlayers,
  type AttackLogView,
  type AttackPlayer,
  type AttackRange,
  type AttackRow,
  type AttackSide,
  type PlayerMatch,
  type TopPlayer,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, count, dateTime } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";
import type { ViewParams } from "./views";

/**
 * The Attack log section (owner, 8 Nov 2026): type a player's name or account
 * number and see every attack they made and every attack on them, newest
 * first, with who they attack most and who attacks them most, to look into
 * bullying, farming the same player, or cheating. Read-only: nothing here
 * changes the game.
 *
 * The address names the player, side and range (`#attacks?player=12&side=made&range=30d`),
 * so Back returns to the player before and a log can be linked. A name on
 * the page opens that player's own log.
 */

export const SIDES: readonly (readonly [AttackSide, string])[] = [
  ["both", "Both"],
  ["made", "By them"],
  ["received", "On them"],
];

export const RANGES: readonly (readonly [AttackRange, string])[] = [
  ["24h", "24 h"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All kept"],
];

const YARD_WORDS: Readonly<Record<string, string>> = {
  main: "Main yard",
  outpost: "Outpost",
  inferno: "Inferno yard",
};

/** "Main yard", "Outpost"; anything else as stored. */
export const yardWord = (type: string): string => YARD_WORDS[type] ?? type;

/** "950", "12.5k", "3.2M": a resource amount in a few characters. */
export const shortNumber = (value: number): string => {
  const n = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (n < 1000) return `${sign}${Math.round(n)}`;
  const [div, unit] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : [1e3, "k"];
  const scaled = n / div;
  return `${sign}${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit}`;
};

const RESOURCE_WORDS: Readonly<Record<string, string>> = {
  r1: "Twigs",
  r2: "Pebbles",
  r3: "Putty",
  r4: "Goo",
  twigs: "Twigs",
  pebbles: "Pebbles",
  putty: "Putty",
  goo: "Goo",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Is a stored loot or report anything but empty? */
export const hasContent = (value: unknown): boolean =>
  isRecord(value) ? Object.keys(value).length > 0 : Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";

/**
 * The loot as short words, "Twigs 12.5k · Goo 900", from whatever numbers the
 * log holds (resources may sit under `resources`); null when there is none.
 */
export const lootWords = (loot: unknown): string | null => {
  const source = isRecord(loot) && isRecord(loot["resources"]) ? loot["resources"] : loot;
  if (!isRecord(source)) return null;
  const parts = Object.entries(source)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0)
    .map(([key, value]) => `${RESOURCE_WORDS[key] ?? key} ${shortNumber(value)}`);
  return parts.length ? parts.join(" · ") : null;
};

/** The result as short words ("Damage 64% · Destroyed · 12 monsters") where the report holds it; null otherwise. */
export const resultWords = (report: unknown): string | null => {
  if (!isRecord(report)) return null;
  const parts: string[] = [];
  const damage = report["damage"] ?? report["damagePercent"];
  if (typeof damage === "number") parts.push(`Damage ${Math.round(damage)}%`);
  if (report["destroyed"] === true || report["destroyed"] === 1) parts.push("Destroyed");
  const monsters = report["monsters"] ?? report["monstersUsed"];
  if (typeof monsters === "number") parts.push(`${count(monsters)} monsters`);
  else if (isRecord(monsters)) {
    const total = Object.values(monsters).reduce<number>((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
    if (total) parts.push(`${count(total)} monsters`);
  }
  return parts.length ? parts.join(" · ") : null;
};

/** A player's chips: Bot (never a real player), or Gone (the account is deleted). */
const playerChips = (player: AttackPlayer): Child[] => [
  player.bot ? h("span", { class: "chip chip-warn", attrs: { title: "Run by the computer, not a real player" } }, "Bot") : null,
  player.gone ? h("span", { class: "chip chip-quiet", attrs: { title: "This account no longer exists" } }, "Gone") : null,
];

/** Where the read parameters ask to go: a player, a side and a range, with defaults. */
export const readAttackParams = (params: ViewParams): { player: number | null; side: AttackSide; range: AttackRange } => {
  const id = Number(params["player"]);
  return {
    player: Number.isSafeInteger(id) && id > 0 ? id : null,
    side: SIDES.find(([s]) => s === params["side"])?.[0] ?? "both",
    range: RANGES.find(([r]) => r === params["range"])?.[0] ?? "7d",
  };
};

export interface AttackLogOptions {
  say(message: string): void;
  /** Puts a player's log in the address (so Back works); the page then calls {@link AttackLogSection.show}. */
  navigate(params: { player: number; side: AttackSide; range: AttackRange }): void;
  /** Opens the player in Find a player (to warn or ban). */
  openPlayer(userid: number): void;
}

export class AttackLogSection {
  readonly element = h("div", { class: "attacks" });
  private readonly search = h("input", {
    class: "field-input",
    attrs: {
      id: "attack-search",
      type: "search",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "search",
      maxlength: "40",
      placeholder: "Name or account number",
    },
  });
  private readonly results = h("div", { class: "results", attrs: { "aria-live": "polite" } });
  private readonly body = h("div", { class: "attack-log" });
  private readonly list = h("ul", { class: "rows attack-rows" });
  private readonly more = h("button", { class: "button quiet modmail-more", attrs: { type: "button", hidden: "" } }, "Load older");
  private side: AttackSide = "both";
  private range: AttackRange = "7d";
  private userid: number | null = null;
  private log: AttackLogView | null = null;
  private searchSeq = 0;
  private loadSeq = 0;

  constructor(private readonly options: AttackLogOptions) {
    const form = h(
      "form",
      { class: "group finder", attrs: { novalidate: "", role: "search" } },
      h("label", { class: "field-label", attrs: { for: "attack-search" } }, "Player"),
      this.search,
      this.results,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.find();
    });
    this.more.addEventListener("click", () => void this.loadMore());
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Every attack a player made or got. Logged when an attack starts; wild monster attacks are not logged.",
      ),
      form,
      this.body,
    );
  }

  /** The page's refresh: the log on show again, from its first page. */
  async refresh(): Promise<void> {
    if (this.userid !== null) await this.load(this.userid);
  }

  /** Shows what the address asks for (`player`, `side`, `range`). */
  async show(params: ViewParams): Promise<void> {
    const wanted = readAttackParams(params);
    const same =
      wanted.player === this.userid && wanted.side === this.side && wanted.range === this.range && this.log !== null;
    this.side = wanted.side;
    this.range = wanted.range;
    if (wanted.player === null || same) return;
    await this.load(wanted.player);
  }

  /** Looks the typed text up: one clear match opens straight away, several give a pick list. */
  async find(): Promise<void> {
    const seq = ++this.searchSeq;
    const query = this.search.value.trim();
    if (!query) {
      replace(this.results);
      return;
    }
    let players: PlayerMatch[];
    try {
      players = (await searchPlayers(query)).players;
    } catch (err) {
      if (seq === this.searchSeq) replace(this.results, h("p", { class: "note" }, `Could not search: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.searchSeq) return;
    const exact = players.filter(
      (p) => String(p.userid) === query || p.username.toLowerCase() === query.toLowerCase(),
    );
    const only = exact.length === 1 ? exact[0] : players.length === 1 ? players[0] : undefined;
    if (only) {
      this.pick(only.userid);
      return;
    }
    replace(
      this.results,
      players.length
        ? h(
            "ul",
            { class: "rows" },
            ...players.map((player) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { class: "row player-row", attrs: { type: "button" }, onClick: () => this.pick(player.userid) },
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-title" }, player.username),
                    h(
                      "span",
                      { class: "row-meta" },
                      [
                        `#${player.userid}`,
                        player.bot ? "bot" : null,
                        player.formerName ? `was called ${player.formerName}` : null,
                        player.lastSeenAt ? `last played ${ago(player.lastSeenAt)}` : "never played",
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ),
                  ),
                  icon("chevron", 18),
                ),
              ),
            ),
          )
        : h("p", { class: "note" }, `No player called “${query}”. Try part of the name, or the account number.`),
    );
  }

  private pick(userid: number): void {
    replace(this.results);
    this.search.value = "";
    this.go(userid, this.side, this.range);
  }

  private go(player: number, side: AttackSide, range: AttackRange): void {
    this.options.navigate({ player, side, range });
  }

  /** Loads the first page of a player's log for the side and range picked. */
  async load(userid: number): Promise<void> {
    const seq = ++this.loadSeq;
    this.userid = userid;
    if (this.log?.player.userid !== userid) replace(this.body, h("div", { class: "skeleton" }));
    let log: AttackLogView;
    try {
      log = (await fetchAttackLog(userid, { side: this.side, range: this.range })).log;
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.log = null;
      replace(this.body, h("p", { class: "form-error" }, `Could not load the attack log of #${userid}: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.loadSeq) return;
    this.log = log;
    this.render();
  }

  private async loadMore(): Promise<void> {
    const log = this.log;
    if (!log?.next) return;
    const seq = this.loadSeq;
    this.more.disabled = true;
    try {
      const page = (await fetchAttackLog(log.player.userid, { side: log.side, range: log.range, before: log.next })).log;
      if (seq !== this.loadSeq) return;
      log.attacks.push(...page.attacks);
      log.next = page.next;
      this.list.append(...page.attacks.map((row) => this.attackRow(row)));
      this.more.hidden = log.next === null;
    } catch (err) {
      this.options.say(`Could not load older attacks: ${errorWords(err)}`);
    } finally {
      this.more.disabled = false;
    }
  }

  /** A player's name that opens their own log. */
  private playerLink(player: AttackPlayer): HTMLElement {
    return h(
      "button",
      {
        class: "link-button",
        attrs: { type: "button", title: `Open ${player.username}'s attack log`, "data-player": String(player.userid) },
        onClick: (event) => {
          // Inside a row's summary: open the log, not the row.
          event.preventDefault();
          event.stopPropagation();
          this.go(player.userid, this.side, this.range);
        },
      },
      player.username,
    );
  }

  private segmented(
    label: string,
    choices: readonly (readonly [string, string])[],
    current: string,
    pick: (value: string) => void,
    counts: Readonly<Record<string, number>> = {},
  ): HTMLElement {
    return h(
      "div",
      { class: "segmented", attrs: { role: "group", "aria-label": label } },
      ...choices.map(([value, words]) =>
        h(
          "button",
          {
            class: "seg",
            attrs: { type: "button", "aria-pressed": String(value === current), "data-value": value },
            onClick: () => pick(value),
          },
          words,
          counts[value] === undefined ? null : h("span", { class: "seg-count" }, count(counts[value])),
        ),
      ),
    );
  }

  private topList(title: string, players: readonly TopPlayer[], none: string): HTMLElement {
    return h(
      "div",
      { class: "group attack-top" },
      h("h3", {}, title),
      players.length
        ? h(
            "ul",
            { class: "rows" },
            ...players.map((player) =>
              h(
                "li",
                {},
                h(
                  "button",
                  {
                    class: "row player-row",
                    attrs: { type: "button", "data-player": String(player.userid) },
                    onClick: () => this.go(player.userid, this.side, this.range),
                  },
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-top" }, h("span", { class: "row-title" }, player.username), ...playerChips(player)),
                    h("span", { class: "row-meta" }, `#${player.userid}`),
                  ),
                  h("span", { class: "row-count", attrs: { title: "Attacks" } }, `×${count(player.count)}`),
                ),
              ),
            ),
          )
        : h("p", { class: "note" }, none),
    );
  }

  private attackRow(row: AttackRow): HTMLElement {
    const made = row.direction === "made";
    const loot = lootWords(row.loot);
    const result = resultWords(row.report);
    const spot = row.x !== null && row.y !== null ? `${row.x}, ${row.y}` : null;
    const stored = { loot: row.loot, attackreport: row.report };
    return h(
      "li",
      {},
      h(
        "details",
        { class: "error-row attack-row", attrs: { "data-direction": row.direction, "data-id": String(row.id) } },
        h(
          "summary",
          {},
          h(
            "span",
            { class: `chip ${made ? "chip-info" : "chip-warn"} attack-dir`, attrs: { title: made ? "They attacked" : "They were attacked" } },
            icon(made ? "out" : "in", 14),
            made ? "By" : "On",
          ),
          h(
            "span",
            { class: "row-main" },
            h(
              "span",
              { class: "row-top" },
              h("span", { class: "row-title" }, made ? "→ " : "← ", this.playerLink(row.other)),
              ...playerChips(row.other),
              h("span", { class: "row-when", attrs: { title: new Date(row.time).toLocaleString() } }, ago(row.time)),
            ),
            h(
              "span",
              { class: "row-meta" },
              [`#${row.other.userid}`, yardWord(row.type), spot, dateTime(row.time), loot, result].filter(Boolean).join(" · "),
            ),
          ),
          icon("chevron", 16),
        ),
        h(
          "div",
          { class: "row-more" },
          h(
            "dl",
            { class: "facts" },
            h("dt", {}, "When"),
            h("dd", {}, new Date(row.time).toLocaleString()),
            h("dt", {}, made ? "Attacked" : "Attacker"),
            h("dd", {}, `${row.other.username} (#${row.other.userid})`, row.other.bot ? " · bot" : null),
            row.otherLoggedName ? h("dt", {}, "Name then") : null,
            row.otherLoggedName ? h("dd", {}, row.otherLoggedName) : null,
            h("dt", {}, "Yard"),
            h("dd", {}, yardWord(row.type)),
            spot ? h("dt", {}, "Map spot") : null,
            spot ? h("dd", {}, spot) : null,
            h("dt", {}, "Loot"),
            h("dd", {}, loot ?? "Not stored"),
            h("dt", {}, "Result"),
            h("dd", {}, result ?? "Not stored"),
          ),
          hasContent(row.loot) || hasContent(row.report)
            ? h("pre", { class: "code" }, JSON.stringify(stored, null, 2))
            : h("p", { class: "hint" }, "The log holds no loot or battle report for this attack."),
        ),
      ),
    );
  }

  private render(): void {
    const log = this.log;
    if (!log) return;
    const { player, summary } = log;
    const heading = h(
      "div",
      { class: "picked-head attack-head" },
      h("h3", { class: "mod-name" }, player.username),
      h("span", { class: "chip chip-quiet" }, `#${player.userid}`),
      ...playerChips(player),
      player.gone
        ? null
        : h(
            "button",
            { class: "button quiet", attrs: { type: "button" }, onClick: () => this.options.openPlayer(player.userid) },
            "Find a player",
          ),
    );
    const sinceWords =
      log.range === "all" ? `Logs are kept ${count(log.retentionDays)} days.` : `Since ${dateTime(log.since)}.`;
    const figures = h(
      "div",
      { class: "figures attack-figures" },
      h(
        "div",
        { class: "figure" },
        h("span", { class: "figure-label" }, icon("out", 14), " By them"),
        h("span", { class: "figure-value" }, count(summary.made)),
        h("span", { class: "figure-sub" }, `on ${count(summary.targets)} ${summary.targets === 1 ? "player" : "players"}`),
      ),
      h(
        "div",
        { class: "figure" },
        h("span", { class: "figure-label" }, icon("in", 14), " On them"),
        h("span", { class: "figure-value" }, count(summary.received)),
        h("span", { class: "figure-sub" }, `by ${count(summary.attackers)} ${summary.attackers === 1 ? "player" : "players"}`),
      ),
    );
    replace(
      this.list,
      ...log.attacks.map((row) => this.attackRow(row)),
    );
    this.more.hidden = log.next === null;
    replace(
      this.body,
      h(
        "div",
        { class: "picked-card attack-card" },
        heading,
        h(
          "div",
          { class: "attack-controls" },
          this.segmented("Period", RANGES, log.range, (value) => this.go(player.userid, this.side, value as AttackRange)),
          h("p", { class: "hint" }, sinceWords),
        ),
        figures,
        h(
          "div",
          { class: "attack-tops" },
          this.topList("They attack most", summary.topTargets, "Nobody in this period."),
          this.topList("Attack them most", summary.topAttackers, "Nobody in this period."),
        ),
        h(
          "div",
          { class: "group" },
          h("h3", {}, "Attacks"),
          this.segmented(
            "Show",
            SIDES,
            log.side,
            (value) => this.go(player.userid, value as AttackSide, this.range),
            { both: summary.made + summary.received, made: summary.made, received: summary.received },
          ),
          log.attacks.length ? this.list : h("p", { class: "note" }, "No attacks in this period."),
          this.more,
        ),
      ),
    );
  }
}
