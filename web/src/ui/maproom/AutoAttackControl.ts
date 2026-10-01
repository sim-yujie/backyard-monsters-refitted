import type { AutoAttackPlanResponse } from "@/api/autoAttack";
import { CellType, isWaterCell, type MapCell } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import { noPlanText, planSourceText, repeatRefusal, shortfallText } from "@/ui/attack/autoAttackText";
import { el, icon } from "@/ui/maproom1/icons";
import type { CellPanelAction } from "./CellPanel";
import "@/ui/styles/autoattack.css";

/**
 * The map cell panel's Repeat attack (issue #221): on a Map Room 2 wild camp,
 * a button under Attack that repeats the player's last attack played by hand
 * on a camp of the same tribe and level, and a line under the actions saying
 * which attack it repeats, or why it cannot run and exactly what is missing.
 *
 * It asks the server (`POST /worldmapv2/autoattackplan`) whenever the cell or
 * its damage changes and shows only what the answer says. The button opens
 * the confirm sheet ({@link AutoAttackControlOptions.onRepeat}); nothing runs
 * from the panel itself. A camp the player has no plan for shows nothing but
 * a hint on how to get one.
 */

export interface AutoAttackControlOptions {
  /** `getAutoAttackPlan`. */
  readonly plan: (baseid: string) => Promise<AutoAttackPlanResponse>;
  /** Opens the confirm sheet for the camp, with the answer already in hand. */
  readonly onRepeat: (cell: OffsetCell, baseid: string, answer: AutoAttackPlanResponse) => void;
  /** Local unix seconds; `Date.now` by default. */
  readonly now?: () => number;
}

/** Where the answer for the shown camp stands. */
export type AutoAttackPlanState =
  | { readonly status: "none" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "answered"; readonly answer: AutoAttackPlanResponse };

/** A Map Room 2 wild camp's base id and tribe, or null for anything else. */
const campOf = (payload: MapCell | undefined): { baseid: string; tribe: string; level: number } | null => {
  if (!payload || isWaterCell(payload) || payload.b !== CellType.WILD_MONSTER) return null;
  return { baseid: payload.bid, tribe: payload.n, level: payload.l };
};

export class AutoAttackControl implements CellPanelAction {
  readonly button: HTMLButtonElement;
  readonly detail: HTMLElement;

  private readonly options: AutoAttackControlOptions;
  private readonly line: HTMLElement;
  private readonly missing: HTMLElement;
  private cell: OffsetCell | null = null;
  private camp: { baseid: string; tribe: string; level: number } | null = null;
  private key: string | null = null;
  private state: AutoAttackPlanState = { status: "none" };
  /** Bumped per request, so a slow answer for an old cell is dropped. */
  private request = 0;

  constructor(options: AutoAttackControlOptions) {
    this.options = options;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--outline mr2-cell__secondary auto-attack-action__button";
    this.button.append(icon("attack", 18, "map-icon"), el("span", "", "Repeat attack"));
    this.button.addEventListener("click", () => this.repeat());

    this.line = el("span", "auto-attack-action__line");
    this.missing = document.createElement("ul");
    this.missing.className = "auto-attack-action__missing";
    this.detail = document.createElement("div");
    this.detail.className = "auto-attack-action";
    this.detail.append(this.line, this.missing);

    this.render();
  }

  setCell(cell: OffsetCell, payload: MapCell | undefined): void {
    const camp = campOf(payload);
    const key = camp && payload && !isWaterCell(payload) ? `${camp.baseid}:${payload.dm}:${payload.d}` : null;
    const sameCell = this.cell?.col === cell.col && this.cell?.row === cell.row;
    this.cell = cell;
    if (sameCell && key === this.key) return;
    this.key = key;
    this.camp = camp;
    if (camp) void this.fetch();
    else {
      this.request += 1;
      this.state = { status: "none" };
    }
    this.render();
  }

  /** Asks the server again for the shown camp: after an auto-attack, say. */
  refresh(): void {
    if (this.camp) void this.fetch();
  }

  tick(): void {}

  /** What is shown, for the tests. */
  get view(): AutoAttackPlanState {
    return this.state;
  }

  destroy(): void {
    this.request += 1;
    this.button.remove();
    this.detail.remove();
  }

  private async fetch(): Promise<void> {
    const camp = this.camp;
    if (!camp) return;
    const request = ++this.request;
    this.state = { status: "loading" };
    this.render();
    try {
      const answer = await this.options.plan(camp.baseid);
      if (request !== this.request) return;
      this.state = { status: "answered", answer };
    } catch {
      if (request !== this.request) return;
      this.state = { status: "failed" };
    }
    this.render();
  }

  private render(): void {
    const state = this.state;
    const camp = this.camp;
    this.missing.replaceChildren();
    this.missing.hidden = true;
    this.detail.classList.remove("auto-attack-action--refused");

    if (!camp || state.status === "none" || state.status === "failed") {
      this.button.hidden = true;
      this.detail.hidden = true;
      return;
    }

    if (state.status === "loading") {
      this.button.hidden = true;
      this.detail.hidden = true;
      return;
    }

    const { answer } = state;
    if (!answer.plan) {
      this.button.hidden = true;
      this.detail.hidden = false;
      this.line.textContent = noPlanText(camp.tribe, camp.level);
      return;
    }

    const refusal = repeatRefusal(answer);
    const source = planSourceText(answer.plan, camp.baseid, this.now());
    this.button.hidden = false;
    this.detail.hidden = false;
    this.button.disabled = refusal !== null;
    this.button.title = refusal ?? source;
    this.button.setAttribute("aria-label", `Repeat attack. ${refusal ?? source}`);
    this.line.textContent = refusal ? `${source}. ${refusal}` : `${source}.`;
    if (refusal) {
      this.detail.classList.add("auto-attack-action--refused");
      for (const item of answer.missing) {
        const row = document.createElement("li");
        row.textContent = shortfallText(item);
        this.missing.append(row);
      }
      this.missing.hidden = answer.missing.length === 0;
    }
  }

  private repeat(): void {
    const { cell, camp, state } = this;
    if (!cell || !camp || state.status !== "answered" || this.button.disabled) return;
    this.options.onRepeat(cell, camp.baseid, state.answer);
  }

  private now(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }
}
