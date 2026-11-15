import { formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import "@/ui/styles/clock-look-preview.css";

/**
 * PREVIEW ONLY (beta 8, 15 Nov 2026). Delete this file, its CSS and its one
 * call site (HudStatus.ts) once the owner has picked.
 *
 * The owner found the reset clock's corner "wayy too cluttered"; Codex astra
 * critiqued it (archive/reset-clock-astra/astra-review.md). These are the
 * layout options it led to, switched on in a dev build only by
 * `?clockLook=a|b|c` (`&clockBoosts=N` adds N made-up boosts, for the
 * "three boosts" pictures). Without the switch nothing here runs and the
 * corner is exactly as before.
 *
 * - **a** The clock pill stays; every status chip becomes a painted icon and
 *   a short time ("3d", "9h"), no names.
 * - **b** astra's pick (its option A): no clock pill (resets would live in Events; the list
 *   hangs under the Events door as a stand-in); the shield with its short
 *   time, and one boosts button with a count that opens their names.
 * - **c** In between: the clock an icon-only round button (its time in the
 *   list); the shield and the boosts button as in b.
 */
export type ClockLook = "a" | "b" | "c";

export const clockLookFrom = (search: string): ClockLook | null => {
  const asked = new URLSearchParams(search).get("clockLook");
  return asked === "a" || asked === "b" || asked === "c" ? asked : null;
};

/** The look asked for, in a dev build only. */
export const clockLook = (): ClockLook | null =>
  import.meta.env.DEV && typeof location !== "undefined" ? clockLookFrom(location.search) : null;

const LOOK = clockLook();
if (LOOK && typeof document !== "undefined") document.documentElement.dataset["clockLook"] = LOOK;

/** "3d 4h" → "3d": the first unit only. */
export const shortTime = (seconds: number): string => formatCountdown(seconds).split(" ")[0] ?? "";

/** A painted icon per boost; the rest share Sharper Tools' (no own icon yet). */
const BOOST_ICON: Readonly<Record<string, GameIconName>> = {
  POD: "overdrive",
  CLOD: "overdrive",
  HOD: "overdrive",
  HOD2: "overdrive",
  HOD3: "overdrive",
  TOD: "overdrive",
  MOD: "overdrive",
  MSOD: "speed",
  MDOD: "damage",
};
export const boostIcon = (item: string): GameIconName => BOOST_ICON[item] ?? "tools";

interface PreviewBoost {
  readonly item: string;
  readonly name: string;
  readonly endsAt: number;
}

/** `&clockBoosts=N`: N made-up boosts so the pictures can show a full strip. */
export const previewFakeBoosts = (now: number): PreviewBoost[] => {
  if (!LOOK) return [];
  const count = Math.min(3, Number(new URLSearchParams(location.search).get("clockBoosts") ?? 0) || 0);
  const fakes: PreviewBoost[] = [
    { item: "BST", name: "Sharper Tools", endsAt: now + 26 * 3_600 + 600 },
    { item: "TOD", name: "Tower Overdrive", endsAt: now + 6 * 3_600 + 720 },
    { item: "MSOD", name: "Monster Speed Buff", endsAt: now + 45 * 60 },
  ];
  return fakes.slice(0, count);
};

const iconChip = (className: string, icon: GameIconName, label: string): HTMLElement => {
  const chip = document.createElement("li");
  chip.className = `hud-status__boost clock-look__chip ${className}`;
  chip.append(gameIcon(icon, { size: 24, decorative: true, className: "clock-look__icon" }));
  const time = document.createElement("span");
  time.className = "clock-look__time";
  chip.append(time);
  chip.title = label;
  return chip;
};

/** The status strip in a preview look: built fresh each tick (it is a preview). */
export class PreviewStatus {
  readonly look: ClockLook;
  private readonly row: HTMLElement;
  private readonly list: HTMLElement;
  private open = false;

  constructor(host: HTMLElement, look: ClockLook) {
    this.look = look;
    this.row = document.createElement("ul");
    this.row.className = "clock-look__row";
    this.list = document.createElement("div");
    this.list.className = "reset-clock__list clock-look__list";
    this.list.hidden = true;
    host.append(this.row, this.list);
  }

  render(protectedUntil: number | null, boosts: readonly PreviewBoost[], now: number): void {
    const cells: HTMLElement[] = [];
    if (protectedUntil !== null) {
      const shield = iconChip("clock-look__shield", "shield", "Protected");
      shield.querySelector(".clock-look__time")!.textContent = shortTime(protectedUntil - now);
      cells.push(shield);
    }
    if (this.look === "a") {
      for (const boost of boosts) {
        const chip = iconChip("", boostIcon(boost.item), boost.name);
        chip.querySelector(".clock-look__time")!.textContent = shortTime(boost.endsAt - now);
        cells.push(chip);
      }
    } else if (boosts.length > 0) {
      const item = document.createElement("li");
      item.className = "clock-look__boostitem";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud-status__boost clock-look__chip clock-look__boosts";
      button.setAttribute("aria-label", `${boosts.length} boosts running`);
      button.append(gameIcon("overdrive", { size: 24, decorative: true, className: "clock-look__icon" }));
      const count = document.createElement("span");
      count.className = "clock-look__count";
      count.textContent = String(boosts.length);
      button.append(count);
      button.addEventListener("click", () => {
        this.open = !this.open;
        this.list.hidden = !this.open;
      });
      item.append(button);
      cells.push(item);
    }
    this.row.replaceChildren(...cells);

    const rows = boosts.map((boost) => {
      const row = document.createElement("li");
      row.className = "reset-clock__row clock-look__listrow";
      const name = document.createElement("span");
      name.className = "reset-clock__title";
      name.append(gameIcon(boostIcon(boost.item), { size: 24, decorative: true, className: "clock-look__icon" }), ` ${boost.name}`);
      const left = document.createElement("span");
      left.className = "reset-clock__left";
      left.textContent = formatCountdown(boost.endsAt - now);
      row.append(name, left);
      return row;
    });
    const ul = document.createElement("ul");
    ul.className = "reset-clock__rows";
    ul.append(...rows);
    this.list.replaceChildren(ul);
    if (boosts.length === 0) this.list.hidden = true;
    else this.list.hidden = !this.open;
  }
}
