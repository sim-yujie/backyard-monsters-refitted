import {
  actOnPhoto,
  fetchPhotoCases,
  type PhotoAction,
  type PhotoCaseList,
  type PhotoCaseView,
} from "./api";
import { h, replace } from "./dom";
import { ago, dateTime, plural } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * Photo reports (beta 7): one card per player whose profile photo was
 * reported, right after Chat cases. Reports from `hideAt` players hide the
 * photo by themselves; here the owner looks at it and keeps it (it shows
 * again, and reports of that upload no longer hide it), removes it, removes
 * it and blocks uploads, or lifts a block. Server: `services/admin/photoReports.ts`.
 */

const OUTCOME_WORDS: Record<NonNullable<PhotoCaseView["closed"]>["outcome"], string> = {
  kept: "Kept",
  removed: "Removed",
  blocked: "Removed + blocked",
  replaced: "Replaced by the player",
};

const ACTION_WORDS: Record<PhotoAction, string> = {
  keep: "Kept",
  remove: "Removed",
  block: "Removed and blocked",
  unblock: "Uploads allowed again",
};

const nameOf = (view: Pick<PhotoCaseView, "userid" | "username">): string => view.username ?? `#${view.userid}`;

/** "Kept by Sim, 2 hours ago". */
export const closedWords = (closed: NonNullable<PhotoCaseView["closed"]>): string =>
  `${OUTCOME_WORDS[closed.outcome]}${closed.byName ? ` by ${closed.byName}` : ""}, ${ago(closed.at)}`;

/** Who reported, newest first, marking reports of an older upload. */
export const reporterWords = (view: PhotoCaseView): string =>
  view.reporters
    .map((reporter) => `${nameOf(reporter)}${reporter.version < view.photoVersion ? " (older photo)" : ""}`)
    .join(", ");

export interface PhotosOptions {
  readonly say: (message: string) => void;
  /** Players with open photo reports, or null when they could not be read. */
  readonly onCount: (open: number | null) => void;
  readonly openPlayer: (userid: number) => void;
}

export class PhotosView {
  readonly element = h("div", { class: "photos" });
  private readonly openList = h("div", { class: "group" }, h("div", { class: "skeleton" }));
  private readonly closedBody = h("div", { class: "group" });
  private readonly closedFold: HTMLDetailsElement;
  private openCases: PhotoCaseView[] = [];
  private openNext: number | null = null;
  private closedCases: PhotoCaseView[] = [];
  private closedNext: number | null = null;
  private closedLoaded = false;
  private hideAt = 3;
  private seq = 0;
  private busy = false;

  constructor(private readonly options: PhotosOptions) {
    this.closedFold = h(
      "details",
      { class: "fold photos-closed" },
      h("summary", {}, icon("chevron", 16), h("span", {}, "Closed")),
      this.closedBody,
    );
    this.closedFold.addEventListener("toggle", () => {
      if (this.closedFold.open && !this.closedLoaded) void this.loadClosed();
    });
    replace(this.element, this.openList, this.closedFold);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.loadOpen(), this.closedFold.open ? this.loadClosed() : Promise.resolve()]);
  }

  private async loadOpen(more = false): Promise<void> {
    const seq = ++this.seq;
    let answer: PhotoCaseList;
    try {
      answer = await fetchPhotoCases("open", more ? (this.openNext ?? undefined) : undefined);
    } catch (err) {
      if (seq !== this.seq) return;
      this.options.onCount(null);
      replace(this.openList, h("p", { class: "note" }, `The photo reports could not be loaded: ${errorWords(err)}`));
      return;
    }
    if (seq !== this.seq) return;
    this.hideAt = answer.hideAt;
    this.openCases = more ? [...this.openCases, ...answer.cases] : answer.cases;
    this.openNext = answer.nextOffset;
    this.options.onCount(answer.open);
    replace(
      this.openList,
      h("p", { class: "note" }, `Reports from ${plural(this.hideAt, "player")} hide a photo until you look.`),
      this.openCases.length
        ? h("ul", { class: "rows photo-list" }, ...this.openCases.map((view) => this.item(view)))
        : h("p", { class: "note" }, "No photo reports to look at."),
      this.openNext !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadOpen(true) },
            "Show more",
          )
        : null,
    );
  }

  private async loadClosed(more = false): Promise<void> {
    if (!more && !this.closedLoaded) replace(this.closedBody, h("div", { class: "skeleton" }));
    let answer: PhotoCaseList;
    try {
      answer = await fetchPhotoCases("closed", more ? (this.closedNext ?? undefined) : undefined);
    } catch (err) {
      replace(this.closedBody, h("p", { class: "note" }, `The closed photo reports could not be loaded: ${errorWords(err)}`));
      return;
    }
    this.closedLoaded = true;
    this.closedCases = more ? [...this.closedCases, ...answer.cases] : answer.cases;
    this.closedNext = answer.nextOffset;
    replace(
      this.closedBody,
      this.closedCases.length
        ? h("ul", { class: "rows photo-list" }, ...this.closedCases.map((view) => this.item(view)))
        : h("p", { class: "note" }, "None closed yet."),
      this.closedNext !== null
        ? h(
            "button",
            { class: "button wide quiet", attrs: { type: "button" }, onClick: () => void this.loadClosed(true) },
            "Show older",
          )
        : null,
    );
  }

  /** One player's card: the photo, who and when, and the buttons. */
  item(view: PhotoCaseView): HTMLElement {
    const picture = view.photo
      ? h("img", {
          class: "photo-case__img",
          attrs: { src: view.photo, alt: `${nameOf(view)}'s photo`, width: "96", height: "96" },
        })
      : h("span", { class: "photo-case__none" }, "No photo");
    const when = view.lastReportAt
      ? h("time", { class: "row-when", attrs: { datetime: view.lastReportAt, title: dateTime(view.lastReportAt) } }, ago(view.lastReportAt))
      : null;
    const buttons: HTMLElement[] = [];
    const action = (kind: PhotoAction, words: string, className: string): HTMLButtonElement =>
      h(
        "button",
        {
          class: `button ${className}`,
          attrs: { type: "button", "data-action": kind },
          onClick: (event) => void this.act(view, kind, event.currentTarget as HTMLButtonElement),
        },
        words,
      );
    if (!view.closed && view.photo) {
      buttons.push(action("keep", "Keep", "primary"), action("remove", "Remove", "quiet"), action("block", "Remove + block", "danger"));
    }
    if (view.blocked) buttons.push(action("unblock", "Unblock", "quiet"));
    return h(
      "li",
      { class: "row photo-case", attrs: { "data-userid": String(view.userid) } },
      h("span", { class: "photo-case__picture" }, picture),
      h(
        "span",
        { class: "row-main" },
        h(
          "span",
          { class: "row-top" },
          h(
            "button",
            { class: "link-button report-who", attrs: { type: "button" }, onClick: () => this.options.openPlayer(view.userid) },
            nameOf(view),
          ),
          view.hidden ? h("span", { class: "chip chip-warn" }, "Hidden") : null,
          view.blocked ? h("span", { class: "chip chip-bad" }, "Blocked") : null,
          // A case closed by Keep already says "Kept by …"; the chip would say it twice.
          view.kept && view.closed?.outcome !== "kept" ? h("span", { class: "chip chip-quiet" }, "Kept before") : null,
          view.banned ? h("span", { class: "chip chip-bad" }, "Banned") : null,
          view.closed ? h("span", { class: "chip chip-good" }, closedWords(view.closed)) : null,
          when,
        ),
        view.reporters.length
          ? h(
              "span",
              { class: "hint photo-case__reporters" },
              icon("flag", 14),
              // Its own box beside the flag: as a bare text node a long list
              // wrapped under the flag and left it alone on a line (375px).
              h("span", { class: "photo-case__reporter-words" }, ` ${plural(view.reporters.length, "report")}: ${reporterWords(view)}`),
            )
          : null,
        buttons.length ? h("span", { class: "actions photo-case__actions" }, ...buttons) : null,
      ),
    );
  }

  private async act(view: PhotoCaseView, kind: PhotoAction, button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      await actOnPhoto(view.userid, kind);
      this.options.say(`${ACTION_WORDS[kind]}: ${nameOf(view)}`);
      this.busy = false;
      await this.refresh();
    } catch (err) {
      this.busy = false;
      button.disabled = false;
      this.options.say(`Could not do that: ${errorWords(err)}`);
    }
  }
}
