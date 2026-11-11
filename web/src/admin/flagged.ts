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

/** "yardlord", or "base 1200" when no yard has that id any more. */
export const yardName = (yard: CheatYard): string => yard.owner?.username ?? `base ${yard.baseid}`;

const botChip = (yard: CheatYard | null): Child =>
  yard?.owner?.bot
    ? h("span", { class: "chip chip-warn", attrs: { title: "Run by the computer, not a real player" } }, "Bot")
    : null;

/** A count chip: an icon, a word and ×n, quiet when it is nothing. */
const countChip = (kind: "fight" | "economy" | "attack", refused: number, flagged = 0): Child => {
  if (refused + flagged === 0) return null;
  const title =
    kind === "attack"
      ? `${refused} tampered attack ${refused === 1 ? "request" : "requests"}`
      : `${refused} refused, ${flagged} only logged · ${KIND_HINTS[kind]}`;
  return h(
    "span",
    {
      class: `chip chip-icon ${refused > 0 ? "chip-bad" : "chip-warn"} flagged-count`,
      attrs: { title, "data-kind": kind },
    },
    icon(refused > 0 ? "bad" : "warn", 14),
    `${KIND_WORDS[kind]} ×${count(refused + flagged)}`,
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
    const refused = players.reduce((sum, p) => sum + p.counts.fight.refused + p.counts.economy.refused, 0);
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
            countChip("fight", counts.fight.refused, counts.fight.flagged),
            countChip("economy", counts.economy.refused, counts.economy.flagged),
            countChip("attack", counts.attack),
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
