import { Panel } from "@/ui/Panel";
import { formatCountdown } from "@/ui/format";
import { artFolder, resolveArt } from "@/game/yard/buildingArt";
import {
  artStateFor,
  BuildingCondition,
  type YardBuilding,
} from "@/game/yard/yardModel";

/**
 * Everything the save says about one building.
 *
 * Like the map's cell inspector this is deliberately exhaustive rather than
 * curated: the yard screen is also how the rest of the client gets checked
 * against the server, so a field that arrives is a field that shows. Where the
 * wire is silent by convention rather than by accident — an absent `l` means
 * level 1, an absent `hp` means full health — the panel says what the absence
 * means instead of showing a gap.
 *
 * Editing is a later task, so the Upgrade button is present and disabled: the
 * shape of the screen is easier to judge with it there.
 */

export interface BuildingPanelOptions {
  onClose: () => void;
}

const UPGRADE_SOON = "Coming soon: the yard is read-only in this build.";

export class BuildingPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly facts: HTMLDListElement;
  private readonly kind: HTMLElement;
  private readonly kindLabel: HTMLElement;
  private readonly swatch: HTMLElement;

  private building: YardBuilding | null = null;
  /** Countdown rows, refreshed once a second by the scene. */
  private countdowns: { node: HTMLElement; endsAt: number }[] = [];

  constructor(options: BuildingPanelOptions) {
    this.panel = new Panel({
      title: "Building",
      className: "map-panel",
      onClose: options.onClose,
    });
    this.element = this.panel.element;

    this.kind = document.createElement("span");
    this.kind.className = "cell-kind";
    this.swatch = document.createElement("span");
    this.swatch.className = "cell-swatch";
    this.kindLabel = document.createElement("span");
    this.kind.append(this.swatch, this.kindLabel);

    this.facts = document.createElement("dl");
    this.facts.className = "cell-facts";

    const actions = document.createElement("div");
    actions.className = "map-row map-row--wrap";
    actions.append(disabledAction("Upgrade", UPGRADE_SOON));

    this.panel.setContent(this.kind, this.facts, actions);
  }

  get shownBuilding(): YardBuilding | null {
    return this.building;
  }

  show(building: YardBuilding): void {
    this.building = building;
    this.panel.setTitle(building.name);
    this.render();
  }

  /** Advances the countdowns. Called once a second by the scene. */
  tick(nowSeconds: number): void {
    for (const entry of this.countdowns) {
      entry.node.textContent = formatCountdown(entry.endsAt - nowSeconds);
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  private render(): void {
    const building = this.building;
    if (!building) return;

    this.facts.replaceChildren();
    this.countdowns = [];

    this.setKind(building);

    this.add("Type id", String(building.type));
    this.add(
      "Level",
      building.level === 0
        ? "0 — foundation, still building"
        : building.raw.l === undefined
          ? "1 (the save omits the level at 1)"
          : String(building.level),
    );

    const [width, height] = building.footprint;
    this.add("Footprint", `${width} x ${height} yard units`);
    this.add("Position", `${building.x}, ${building.y}`);
    this.add("Building id", String(building.id));

    this.add(
      "Fortification",
      building.fortification === 0 ? "None" : `Level ${building.fortification}`,
      building.fortification > 0 ? "is-info" : undefined,
    );

    this.addHealth(building);
    this.addCountdown(building);
    this.addProduction(building);
    this.addArt(building);
  }

  private addHealth(building: YardBuilding): void {
    if (building.hp === null) {
      this.add(
        "Health",
        building.maxHp === null
          ? "Full (the save omits health above full)"
          : `${building.maxHp.toLocaleString()} / ${building.maxHp.toLocaleString()}`,
      );
      return;
    }

    this.add(
      "Health",
      building.maxHp === null
        ? building.hp.toLocaleString()
        : `${building.hp.toLocaleString()} / ${building.maxHp.toLocaleString()}`,
      "is-danger",
    );
  }

  private addCountdown(building: YardBuilding): void {
    const countdown = building.countdown;
    if (!countdown) return;

    const label =
      countdown.kind === "build"
        ? "Building"
        : countdown.kind === "upgrade"
          ? "Upgrading"
          : countdown.kind === "fortify"
            ? "Fortifying"
            : "Rebuilding";

    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.className = "is-info";
    definition.textContent = formatCountdown(countdown.endsAt - Date.now() / 1000);
    this.facts.append(term, definition);
    this.countdowns.push({ node: definition, endsAt: countdown.endsAt });
  }

  /** Harvester fields: what is banked in the building and whether it is running. */
  private addProduction(building: YardBuilding): void {
    const stored = building.raw.st;
    if (typeof stored === "number") {
      this.add("Stored", stored.toLocaleString());
    }
    const cycle = building.raw.rCP;
    if (typeof cycle === "number" && cycle > 0) {
      this.add("Cycle left", `${cycle}s at the last save`);
    }
    if (building.raw.rE === 1) this.add("Repairing", "Yes", "is-info");
  }

  /** Which picture this building is showing, which is the first thing to check
   * when one looks wrong. */
  private addArt(building: YardBuilding): void {
    const art = resolveArt(building.type, building.level, artStateFor(building.condition));
    if (!art) {
      this.add("Art", `No art for type ${building.type}`, "is-danger");
      return;
    }
    const folder = artFolder(building.type) ?? "";
    this.add("Art", `${folder}${art.top.url.slice(art.top.url.lastIndexOf("/") + 1)}`);
    if (art.level !== building.level && building.level > 0) {
      this.add("Art level", `${art.level} (this building's art changes at ${art.level})`);
    }
  }

  private setKind(building: YardBuilding): void {
    const [label, colour] =
      building.condition === BuildingCondition.DESTROYED
        ? ["Destroyed", "var(--colour-danger, #d46a6a)"]
        : building.condition === BuildingCondition.DAMAGED
          ? ["Damaged", "var(--colour-warning, #d4a76a)"]
          : building.level === 0
            ? ["Under construction", "var(--colour-accent)"]
            : ["Intact", "var(--colour-text)"];
    this.kindLabel.textContent = label;
    this.swatch.style.background = colour;
  }

  private add(label: string, value: string, className?: string): void {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    if (className) definition.className = className;
    this.facts.append(term, definition);
  }
}

const disabledAction = (label: string, tooltip: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.disabled = true;
  button.title = tooltip;
  // `title` alone is not exposed on a disabled control in every browser.
  button.setAttribute("aria-label", `${label}. ${tooltip}`);
  return button;
};
