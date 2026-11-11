import {
  fetchCheatPlayer,
  fetchCheatPlayers,
  type CheatEntry,
  type CheatPlayer,
  type CheatYard,
} from "./api";
import { h, replace, type Child } from "./dom";
import { ago, count, dateTime } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * The Flagged list (owner, 11 Nov 2026): the players the cheat checks caught,
 * one row per player, newest first. Each row shows how many saves the checks
 * refused (fight and economy), what did not match, which yards (the yard
 * owner's name, "Bot" when the computer runs it) and when. Opening a row
 * loads every entry. Read-only: nothing here bans or changes a player; the
 * row links to Find a player and the Attack log for that.
 */

/** Short words for the fight check's fields (`battle.ts` `battleMismatches`). */
const FIELD_WORDS: Readonly<Record<string, string>> = {
  damage: "Damage %",
  destroyed: "Destroyed",
  buildinghealthdata: "Building health",
  firedTraps: "Traps",
  attackloot: "Loot",
  attackerchampion: "Champion HP",
  attackersiege: "Siege",
  champion: "Defending champion",
};

/** A field or rule as short words: the fight's in plain words, an economy rule split at its capitals. */
export const fieldWord = (name: string): string =>
  FIELD_WORDS[name] ??
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

const KIND_WORDS: Readonly<Record<CheatEntry["kind"], string>> = {
  fight: "Fight",
  economy: "Economy",
  attack: "Tampered attack",
  other: "Other",
};

const KIND_HINTS: Readonly<Record<CheatEntry["kind"], string>> = {
  fight: "The attack save did not match the server's own replay of the battle",
  economy: "A yard save broke an economy rule",
  attack: "The attack request was changed (this check also bans)",
  other: "Another report",
};

/** The first Descent yard's base id: yards 1-13 are 201-213. */
const DESCENT_FIRST_BASEID = 201;

/**
 * A yard by what it is: its owner's name ("yardlord"), "Descent yard 1",
 * "Moloch tribe (base 300)", "Map Room 1 tribe (base 5)", or plainly
 * "base 201" when the entry did not say what it is or the yard is gone.
 * Never an owner guessed from a base id alone.
 */
export const yardName = (yard: CheatYard): string => {
  switch (yard.kind) {
    case "descent": {
      const level = Number(yard.baseid) - DESCENT_FIRST_BASEID + 1;
      return Number.isInteger(level) && level >= 1 ? `Descent yard ${level}` : `Descent (base ${yard.baseid})`;
    }
    case "inferno-tribe":
      return `Moloch tribe (base ${yard.baseid})`;
    case "mr1-tribe":
      return `Map Room 1 tribe (base ${yard.baseid})`;
    case "yard":
      return yard.owner?.username ?? (yard.baseid ? `base ${yard.baseid}` : "a yard now gone");
    default:
      return `base ${yard.baseid}`;
  }
};

const botChip = (yard: CheatYard | null): Child =>
  yard?.owner?.bot
    ? h("span", { class: "chip chip-warn", attrs: { title: "Run by the computer, not a real player" } }, "Bot")
    : null;

/**
 * A count chip: an icon, a word and ×n, nothing when n is 0. Red for refused
 * saves (and tampered attack requests), amber "logged" for saves only logged,
 * so the red chips add up to the "Refused saves" figure and the amber ones to
 * "Only logged".
 */
const countChip = (kind: "fight" | "economy" | "attack", n: number, outcome: "refused" | "logged"): Child => {
  if (n === 0) return null;
  const refused = outcome === "refused";
  const title =
    kind === "attack"
      ? `${n} tampered attack ${n === 1 ? "request" : "requests"} · ${KIND_HINTS[kind]}`
      : `${n} ${n === 1 ? "save" : "saves"} ${refused ? "refused" : "only logged, not refused"} · ${KIND_HINTS[kind]}`;
  return h(
    "span",
    {
      class: `chip chip-icon ${refused ? "chip-bad" : "chip-warn"} flagged-count`,
      attrs: { title, "data-kind": kind, "data-outcome": outcome },
    },
    icon(refused ? "bad" : "warn", 14),
    `${KIND_WORDS[kind]} ×${count(n)}${refused ? "" : " logged"}`,
  );
};

const fieldChips = (fields: readonly { name: string; count?: number }[]): Child[] =>
  fields.map(({ name, count: n }) =>
    h(
      "span",
      { class: "chip chip-quiet flagged-field", attrs: { title: name, "data-field": name } },
      fieldWord(name),
      n !== undefined && n > 1 ? ` ×${count(n)}` : null,
    ),
  );

export interface FlaggedOptions {
  say(message: string): void;
  /** Opens the player in Find a player (to warn or ban). */
  openPlayer(userid: number): void;
  /** Opens the player's Attack log. */
  openAttacks(userid: number): void;
}

export class FlaggedSection {
  readonly element = h("div", { class: "flagged" });
  private readonly body = h("div", { class: "flagged-body" });
  private players: CheatPlayer[] | null = null;
  private loadSeq = 0;

  constructor(private readonly options: FlaggedOptions) {
    replace(
      this.element,
      h(
        "p",
        { class: "lede" },
        "Players the cheat checks caught. A refused save gave the player nothing for that fight or save.",
      ),
      this.body,
    );
  }

  async refresh(): Promise<void> {
    const seq = ++this.loadSeq;
    if (this.players === null) replace(this.body, h("div", { class: "skeleton" }));
    let players: CheatPlayer[];
    try {
      players = (await fetchCheatPlayers()).players;
    } catch (err) {
      if (seq !== this.loadSeq) return;
      replace(this.body, h("p", { class: "form-error" }, `Could not load the flagged players: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.loadSeq) return;
    this.players = players;
    this.render();
  }

  private render(): void {
    const players = this.players ?? [];
    if (!players.length) {
      replace(this.body, h("p", { class: "note" }, "Nobody has been flagged."));
      return;
    }
    // Each figure is the sum of one colour of chip below it.
    const refused = players.reduce((sum, p) => sum + p.counts.fight.refused + p.counts.economy.refused, 0);
    const logged = players.reduce((sum, p) => sum + p.counts.fight.flagged + p.counts.economy.flagged, 0);
    const tampered = players.reduce((sum, p) => sum + p.counts.attack, 0);
    replace(
      this.body,
      h(
        "div",
        { class: "figures flagged-figures" },
        h(
          "div",
          { class: "figure" },
          h("span", { class: "figure-label" }, icon("flag", 14), " Players"),
          h("span", { class: "figure-value" }, count(players.length)),
        ),
        h(
          "div",
          { class: "figure" },
          h("span", { class: "figure-label" }, icon("bad", 14), " Refused saves"),
          h("span", { class: "figure-value" }, count(refused)),
        ),
        h(
          "div",
          { class: "figure", attrs: { title: "Saves that broke a check but were let through (the check only logs)" } },
          h("span", { class: "figure-label" }, icon("warn", 14), " Only logged"),
          h("span", { class: "figure-value" }, count(logged)),
        ),
        tampered
          ? h(
              "div",
              { class: "figure" },
              h("span", { class: "figure-label" }, icon("bad", 14), " Tampered attacks"),
              h("span", { class: "figure-value" }, count(tampered)),
            )
          : null,
      ),
      h("ul", { class: "rows flagged-rows" }, ...players.map((player) => this.playerRow(player))),
    );
  }

  private playerRow(player: CheatPlayer): HTMLElement {
    const { counts } = player;
    const history = h("div", { class: "flagged-history" }, h("div", { class: "skeleton" }));
    let loaded = false;
    const details = h(
      "details",
      { class: "error-row flagged-row", attrs: { "data-player": String(player.userid) } },
      h(
        "summary",
        {},
        h(
          "span",
          { class: "row-main" },
          h(
            "span",
            { class: "row-top" },
            h("span", { class: "row-title" }, player.username),
            h("span", { class: "chip chip-quiet" }, `#${player.userid}`),
            player.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
            player.gone ? h("span", { class: "chip chip-quiet", attrs: { title: "This account no longer exists" } }, "Gone") : null,
            player.last
              ? h("span", { class: "row-when", attrs: { title: new Date(player.last).toLocaleString() } }, ago(player.last))
              : null,
          ),
          h(
            "span",
            { class: "row-top flagged-counts" },
            countChip("fight", counts.fight.refused, "refused"),
            countChip("economy", counts.economy.refused, "refused"),
            countChip("fight", counts.fight.flagged, "logged"),
            countChip("economy", counts.economy.flagged, "logged"),
            countChip("attack", counts.attack, "refused"),
            counts.other ? h("span", { class: "chip chip-quiet" }, `Other ×${count(counts.other)}`) : null,
          ),
          player.fields.length ? h("span", { class: "row-top flagged-fields" }, ...fieldChips(player.fields)) : null,
          player.yards.length
            ? h(
                "span",
                { class: "row-meta flagged-yards" },
                icon("home", 14),
                ...player.yards.flatMap((yard, i) => [
                  i > 0 ? " · " : null,
                  h("span", { class: "flagged-yard", attrs: { title: `Base ${yard.baseid}` } }, yardName(yard)),
                  yard.owner?.bot ? " (bot)" : null,
                  yard.count > 1 ? ` ×${count(yard.count)}` : null,
                ]),
              )
            : null,
        ),
        icon("chevron", 16),
      ),
      h(
        "div",
        { class: "row-more" },
        h(
          "div",
          { class: "flagged-actions" },
          player.gone
            ? null
            : h(
                "button",
                { class: "button quiet", attrs: { type: "button" }, onClick: () => this.options.openPlayer(player.userid) },
                "Find a player",
              ),
          h(
            "button",
            { class: "button quiet", attrs: { type: "button" }, onClick: () => this.options.openAttacks(player.userid) },
            "Attack log",
          ),
        ),
        player.banReason
          ? h("p", { class: "hint" }, `Ban reason: ${player.banReason.message}`)
          : null,
        history,
      ),
    );
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) return;
      loaded = true;
      void this.loadHistory(player.userid, history).catch(() => {
        loaded = false;
      });
    });
    return h("li", {}, details);
  }

  /** Loads one player's entries into their opened row. */
  async loadHistory(userid: number, into: HTMLElement): Promise<void> {
    let history: CheatEntry[];
    try {
      history = (await fetchCheatPlayer(userid)).history;
    } catch (err) {
      replace(into, h("p", { class: "form-error" }, `Could not load the entries: ${errorWords(err)}`));
      throw err;
    }
    replace(
      into,
      history.length
        ? h("ol", { class: "flagged-entries" }, ...history.map((entry) => this.entryRow(entry)))
        : h("p", { class: "note" }, "No entries."),
    );
  }

  private entryRow(entry: CheatEntry): HTMLElement {
    const refused = entry.outcome === "refused";
    return h(
      "li",
      { class: "flagged-entry", attrs: { "data-kind": entry.kind } },
      h(
        "span",
        { class: "row-top" },
        h(
          "span",
          {
            class: `chip chip-icon ${entry.kind === "other" ? "chip-quiet" : refused || entry.kind === "attack" ? "chip-bad" : "chip-warn"}`,
            attrs: { title: KIND_HINTS[entry.kind] },
          },
          icon(entry.kind === "other" ? "flag" : refused || entry.kind === "attack" ? "bad" : "warn", 14),
          KIND_WORDS[entry.kind],
          entry.outcome ? ` · ${refused ? "Refused" : "Logged"}` : null,
        ),
        entry.yard
          ? h(
              "span",
              { class: "flagged-yard", attrs: { title: `Base ${entry.yard.baseid}` } },
              icon("home", 14),
              " ",
              yardName(entry.yard),
            )
          : null,
        botChip(entry.yard),
        entry.time
          ? h("span", { class: "row-when", attrs: { title: new Date(entry.time).toLocaleString() } }, dateTime(entry.time))
          : null,
      ),
      entry.fields.length ? h("span", { class: "row-top flagged-fields" }, ...fieldChips(entry.fields.map((name) => ({ name })))) : null,
      h("span", { class: "row-meta flagged-message" }, entry.message),
    );
  }
}
