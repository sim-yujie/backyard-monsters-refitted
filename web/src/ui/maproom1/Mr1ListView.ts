import { tutTarget, TutTarget } from "@/game/guide/targets";
import {
  battleCounts,
  isPlayingNow,
  LIST_SORT_DIRECTIONS,
  LIST_SORT_LABELS,
  ListSort,
  pageOf,
  respawnIn,
  rowLine,
  sortNeighbours,
  type Mr1World,
  type SortDirection,
} from "@/game/maproom1/mr1Model";
import { tribeInfo } from "@/game/maproom1/tribes";
import { avatar, battleIcons, countdown } from "./TargetCard";
import { onlineDot } from "@/ui/onlineDot";
import { loadSortPref, saveSortPref } from "@/ui/sortPrefs";
import { button, el, icon } from "./icons";

/**
 * The List view (`com/monsters/maproom/views/ListView.as`): the tribes as
 * four tiles, then the neighbours seven to a page with page arrows, sortable
 * by level, last seen, name, battles or status as Flash's were
 * (`ListView.as:37`, `:44`, `:181-238`), either way round. The sort and its
 * direction are remembered in this browser. A row opens the same card the
 * map's pins do.
 */

/** Where the neighbour list's sort is remembered. */
export const MR1_LIST_SORT_KEY = "bymr.mr1.list-sort";

const DEFAULT_SORT = {
  sort: ListSort.LEVEL,
  direction: LIST_SORT_DIRECTIONS[ListSort.LEVEL].start,
} as const;

export interface ListViewHandlers {
  readonly onSelect: (key: string) => void;
}

export class Mr1ListView {
  readonly element: HTMLElement;

  private readonly tribes: HTMLElement;
  private readonly count: HTMLElement;
  private readonly sort: HTMLSelectElement;
  private readonly direction: HTMLButtonElement;
  private readonly rows: HTMLElement;
  private readonly pager: HTMLElement;
  private readonly pageLabel: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  private world: Mr1World | null = null;
  private now = 0;
  private page = 0;
  private selected: string | null = null;
  private sortKey: ListSort;
  private sortDirection: SortDirection;

  constructor(private readonly handlers: ListViewHandlers) {
    this.element = el("div", "mr1-list");

    const tribeSection = el("section", "mr1-list__section");
    tribeSection.setAttribute("aria-labelledby", "mr1-tribes-heading");
    tutTarget(tribeSection, TutTarget.MR1_TRIBES);
    const tribeHeading = el("h2", "mr1-list__heading", "Wild monster tribes");
    tribeHeading.id = "mr1-tribes-heading";
    this.tribes = el("div", "mr1-list__tribes");
    tribeSection.append(tribeHeading, this.tribes);

    const neighbourSection = el("section", "mr1-list__section");
    neighbourSection.setAttribute("aria-labelledby", "mr1-neighbours-heading");
    tutTarget(neighbourSection, TutTarget.MR1_NEIGHBOURS);
    const head = el("div", "mr1-list__head");
    this.count = el("h2", "mr1-list__heading", "Neighbours");
    this.count.id = "mr1-neighbours-heading";
    const saved = loadSortPref(MR1_LIST_SORT_KEY, Object.values(ListSort), DEFAULT_SORT);
    this.sortKey = saved.sort;
    this.sortDirection = saved.direction;
    const sortBox = el("div", "mr1-list__sort");
    const sortLabel = el("label", "mr1-list__sort-label");
    sortLabel.append(el("span", undefined, "Sort:"));
    this.sort = el("select", "mr1-list__sort-select");
    for (const [value, label] of Object.entries(LIST_SORT_LABELS)) {
      const option = el("option", undefined, label);
      option.value = value;
      this.sort.append(option);
    }
    this.sort.value = this.sortKey;
    this.sort.addEventListener("change", () => {
      this.sortKey = this.sort.value as ListSort;
      this.sortDirection = LIST_SORT_DIRECTIONS[this.sortKey].start;
      this.resort();
    });
    sortLabel.append(this.sort);
    this.direction = button("btn mr1-list__sort-dir");
    this.direction.addEventListener("click", () => {
      this.sortDirection = this.sortDirection === "desc" ? "asc" : "desc";
      this.resort();
    });
    this.showDirection();
    sortBox.append(sortLabel, this.direction);
    head.append(this.count, sortBox);

    this.rows = el("div", "mr1-list__rows");
    this.pager = el("div", "mr1-list__pager");
    this.prev = button("btn btn--icon mr1-list__page");
    this.prev.setAttribute("aria-label", "Previous page");
    this.prev.append(icon("chevronLeft", 18));
    this.prev.addEventListener("click", () => this.turn(-1));
    this.next = button("btn btn--icon mr1-list__page");
    this.next.setAttribute("aria-label", "Next page");
    this.next.append(icon("chevronRight", 18));
    this.next.addEventListener("click", () => this.turn(1));
    this.pageLabel = el("span", "mr1-list__page-label");
    this.pageLabel.setAttribute("aria-live", "polite");
    this.pager.append(this.prev, this.pageLabel, this.next);

    neighbourSection.append(head, this.rows, this.pager);
    this.element.append(tribeSection, neighbourSection);
  }

  setData(world: Mr1World, now: number): void {
    this.world = world;
    this.now = now;
    this.render();
  }

  setSelected(key: string | null): void {
    this.selected = key;
    for (const control of this.element.querySelectorAll<HTMLElement>("[data-key]")) {
      control.setAttribute("aria-pressed", String(control.dataset["key"] === key));
    }
  }

  /** Back to page one in the new order, remembered for next time. */
  private resort(): void {
    saveSortPref(MR1_LIST_SORT_KEY, { sort: this.sortKey, direction: this.sortDirection });
    this.showDirection();
    this.page = 0;
    this.render();
  }

  /** The direction button's arrow and words for the current order. */
  private showDirection(): void {
    const words = LIST_SORT_DIRECTIONS[this.sortKey][this.sortDirection];
    this.direction.dataset["direction"] = this.sortDirection;
    this.direction.setAttribute("aria-label", `Order: ${words}`);
    this.direction.title = words;
    this.direction.replaceChildren(
      icon(this.sortDirection === "desc" ? "sortDesc" : "sortAsc", 18),
    );
  }

  private turn(step: number): void {
    this.page += step;
    this.render();
    (step < 0 ? this.prev : this.next).focus();
  }

  private render(): void {
    const world = this.world;
    if (!world) return;
    const now = this.now;

    this.tribes.replaceChildren(
      ...world.tribes.map((tribe) => {
        const tile = button("mr1-tile");
        tile.dataset["key"] = tribe.key;
        // The guided start's practice camp (#227): its own name, glowing, Bob's target.
        if (tribe.practice) {
          tile.classList.add("mr1-tile--practice");
          tutTarget(tile, TutTarget.MR1_PRACTICE);
        }
        const left = respawnIn(tribe, now);
        if (left !== null) tile.classList.add("mr1-tile--wrecked");
        const words = el("span", "mr1-tile__words");
        words.append(el("span", "mr1-tile__name", tribe.practice ? tribe.name : tribeInfo(tribe.tribe).name));
        const sub = el("span", "mr1-tile__sub");
        if (left !== null && tribe.respawnAt !== null) {
          sub.append(
            "Back in ",
            countdown(tribe.respawnAt, now, "mr1-countdown mr1-countdown--plain"),
          );
          tile.setAttribute(
            "aria-label",
            `${tribe.name}, wrecked, back in ${Math.ceil(left / 60)} minutes`,
          );
        } else {
          sub.textContent = `Level ${tribe.level}`;
          tile.setAttribute("aria-label", `${tribe.name}, level ${tribe.level}`);
        }
        words.append(sub);
        tile.append(avatar(tribe, "sm"), words);
        tile.addEventListener("click", () => this.handlers.onSelect(tribe.key));
        return tile;
      }),
    );

    this.count.textContent = `Neighbours · ${world.neighbours.length}`;
    const sorted = sortNeighbours(world.neighbours, this.sortKey, now, this.sortDirection);
    const page = pageOf(sorted, this.page);
    this.page = page.page;

    if (!sorted.length) {
      this.rows.replaceChildren(
        el(
          "p",
          "mr1-list__empty",
          "No neighbours yet. Players on Map Room 1 near your level show up here.",
        ),
      );
    } else {
      this.rows.replaceChildren(
        ...page.items.map((neighbour) => {
          const row = button("mr1-row");
          row.dataset["key"] = neighbour.key;
          const line = rowLine(neighbour, now);
          const online = isPlayingNow(neighbour, now);
          const battles = battleCounts(neighbour).map((count) => count.label);
          row.setAttribute(
            "aria-label",
            [
              neighbour.name,
              `level ${neighbour.level}`,
              online ? "online" : "",
              line,
              ...battles,
            ]
              .filter(Boolean)
              .join(", "),
          );
          const words = el("span", "mr1-row__words");
          const top = el("span", "mr1-row__top");
          top.append(el("span", "mr1-row__name", neighbour.name));
          if (online) top.append(onlineDot());
          top.append(el("span", "chip mr1-chip--small", `Lv ${neighbour.level}`));
          words.append(top);
          const icons = battleIcons(neighbour);
          if (line || icons) {
            const second = el("span", "mr1-row__line", line);
            if (icons) second.append(icons);
            words.append(second);
          }
          row.append(
            avatar(neighbour, "sm"),
            words,
            icon("chevronRight", 16, "mr1-icon mr1-row__chevron"),
          );
          row.addEventListener("click", () => this.handlers.onSelect(neighbour.key));
          return row;
        }),
      );
    }

    this.pager.hidden = page.pages <= 1;
    this.pageLabel.textContent = `Page ${page.page + 1} of ${page.pages}`;
    this.prev.disabled = page.page === 0;
    this.next.disabled = page.page >= page.pages - 1;
    this.setSelected(this.selected);
  }
}
