import {
  BAITER_REFUSAL_TEXT,
  baiterRefusalOf,
  baiterTestsApi,
  type BaiterTestsApi,
  type BaiterTestsResponse,
  type FriendTestResult,
  type FriendTestRow,
  type InviteCandidate,
  type ReceivedInvite,
} from "@/api/baiterTests";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import { ownerRunOf, reportOf } from "@/game/baiter/friendTest";
import type { TestReport } from "@/game/baiter/testReport";
import { DEFENCE_REFUSAL_TEXT } from "@/game/defences/defenceWatch";
import { agoText } from "@/ui/attack/autoAttackText";
import { make, playerRow } from "@/ui/friends/rows";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import "@/ui/friends/friends.css";
import "@/ui/styles/baiterFriends.css";

/**
 * The Baiter window's friend tabs (beta 9 feature #4, owner's design A, desk
 * card b9-baiter-screen): **Invite** (pick friends and alliance mates, send a
 * 24 h invite, see and cancel the open ones), **Invited me** (who invited the
 * player, with the cap of THEIR Baiter and the time left, and Test) and
 * **Results** (every test of the player's yard, newest first, with Watch and
 * Report). One `GET /baiter/tests` fills all three.
 *
 * The same Invited me view also stands alone ({@link BaiterFriends.invitedMe}
 * in `BaiterInvitesWindow`) for a player with no Baiter of their own: an
 * invite needs only the INVITER's Baiter.
 */

export type FriendsView = "invite" | "invitedMe" | "results";

export interface BaiterFriendsOptions {
  /** A friend's invite was taken up: open the test army for their yard. */
  readonly onTest: (invite: ReceivedInvite) => void;
  /** Plays a kept test of the player's yard. */
  readonly onWatch?: (run: BaiterRun) => void;
  /** Shows a kept test's report, with its run to watch when this client can play it. */
  readonly onReport?: (report: TestReport, run: BaiterRun | null) => void;
  /** The tab counts changed: Invited me and Results. */
  readonly onCounts?: (counts: { readonly invitedMe: number; readonly results: number; readonly fresh: number }) => void;
  /** The player's own tests this session, shown under Results (the Baiter's old Recent tests). */
  readonly ownTests?: HTMLElement | null;
  readonly api?: BaiterTestsApi;
  readonly now?: () => number;
}

/** "21h" / "40m": what is left of an invite. */
export const leftText = (seconds: number): string => {
  const span = Math.max(0, Math.floor(seconds));
  if (span >= 3_600) return `${Math.floor(span / 3_600)}h`;
  return `${Math.max(1, Math.floor(span / 60))}m`;
};

/** "2m 41s": a test's length (not to be read as a time of day). */
export const lengthText = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes === 0 ? `${rest}s` : rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

export const RESULT_WORDS: Readonly<Record<FriendTestResult, string>> = {
  held: "Held",
  flattened: "Flattened",
  time: "Time ran out",
  stopped: "Stopped",
};

/** The newest result the player has seen, kept in this browser for the "new" dots. */
const SEEN_KEY = "bymr.baiterResultsSeen";

const readSeen = (): number => {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};

const writeSeen = (at: number): void => {
  try {
    window.localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // A private window: the dots simply show again next time.
  }
};

const btn = (label: string, kind: "primary" | "outline" | "ghost", className: string): HTMLButtonElement => {
  const node = make("button", `btn btn--${kind} ${className}`, label);
  node.type = "button";
  return node;
};

const iconBtn = (icon: GameIconName, label: string, kind: "primary" | "outline" | "ghost", className: string): HTMLButtonElement => {
  const node = btn("", kind, `baiter-friends__iconbtn ${className}`);
  node.append(gameIcon(icon, { size: 24, decorative: true }), make("span", "", label));
  return node;
};

const figure = (icon: GameIconName, label: string, value: string, className: string): HTMLElement => {
  const node = make("span", className);
  node.append(gameIcon(icon, { size: 16, label }), value);
  return node;
};

export class BaiterFriends {
  /** The three views, each a `.baiter__view` for the Baiter window's tab row. */
  readonly invite: HTMLElement;
  readonly invitedMe: HTMLElement;
  readonly results: HTMLElement;

  private readonly options: BaiterFriendsOptions;
  private readonly api: BaiterTestsApi;
  private readonly now: () => number;
  private data: BaiterTestsResponse | null = null;
  private readonly picked = new Set<number>();
  /** Which people the Invite list shows; "invited" (phones only) lists the open invites instead. */
  private filter: "all" | "friends" | "alliance" | "invited" = "all";
  private search = "";
  private testerFilter: number | null = null;
  private seen = readSeen();
  private readonly status: HTMLElement;
  private readonly resultsStatus: HTMLElement;
  private footNote: HTMLElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private destroyed = false;

  constructor(options: BaiterFriendsOptions) {
    this.options = options;
    this.api = options.api ?? baiterTestsApi;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.invite = make("div", "baiter__view baiter-friends baiter-friends--invite");
    this.invitedMe = make("div", "baiter__view baiter-friends baiter-friends--received");
    this.results = make("div", "baiter__view baiter-friends baiter-friends--results");
    this.status = make("p", "baiter-friends__status");
    this.status.setAttribute("role", "status");
    this.resultsStatus = make("p", "baiter-friends__status");
    this.resultsStatus.setAttribute("role", "status");
    for (const view of [this.invite, this.invitedMe, this.results]) view.append(make("p", "baiter__note", "Loading…"));
  }

  /** Reads the lists from the server and draws the three views. */
  async load(): Promise<void> {
    try {
      const data = await this.api.list();
      if (this.destroyed) return;
      this.data = data;
      for (const gone of [...this.picked]) if (!data.candidates.some((one) => one.userid === gone)) this.picked.delete(gone);
      this.render();
    } catch (error) {
      if (this.destroyed) return;
      const words = BAITER_REFUSAL_TEXT[baiterRefusalOf(error)];
      for (const view of [this.invite, this.invitedMe, this.results]) {
        const retry = btn("Try again", "outline", "baiter-friends__retry");
        retry.addEventListener("click", () => void this.load());
        view.replaceChildren(make("p", "baiter__note", words), retry);
      }
    }
  }

  /** The Results tab was opened: its rows are no longer new. */
  markSeen(): void {
    const newest = this.data?.results[0]?.foughtAt ?? 0;
    if (newest <= this.seen) return;
    writeSeen(newest);
    this.seen = newest;
    this.options.onCounts?.(this.counts());
  }

  destroy(): void {
    this.destroyed = true;
  }

  private counts(): { invitedMe: number; results: number; fresh: number } {
    const data = this.data;
    return {
      invitedMe: data?.invitedMe.length ?? 0,
      results: data?.results.length ?? 0,
      fresh: data?.results.filter((one) => one.foughtAt > this.seen).length ?? 0,
    };
  }

  private render(): void {
    this.renderInvite();
    this.renderInvitedMe();
    this.renderResults();
    this.options.onCounts?.(this.counts());
  }

  /* ── Invite ──────────────────────────────────────────────────────────── */

  private renderInvite(): void {
    const data = this.data;
    if (!data) return;
    if (data.baiterLevel <= 0) {
      this.invite.replaceChildren(make("p", "baiter__note", "Build a Wild Monster Baiter to invite friends to test your yard."));
      return;
    }
    const pick = make("section", "baiter-friends__col baiter-friends__col--pick");
    pick.setAttribute("aria-label", "Pick who to invite");
    const friends = data.candidates.filter((one) => one.friend).length;
    const mates = data.candidates.filter((one) => one.alliance).length;
    const chips = make("div", "baiter-friends__chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Show");
    const chip = (key: typeof this.filter, label: string) => {
      const node = btn(label, this.filter === key ? "primary" : "outline", `baiter-friends__chip baiter-friends__chip--${key}`);
      node.setAttribute("aria-pressed", String(this.filter === key));
      node.addEventListener("click", () => {
        this.filter = key;
        this.renderInvite();
      });
      return node;
    };
    chips.append(
      chip("all", `All ${data.candidates.length}`),
      // A phone has no room for the open invites beside the list: they are a filter of
      // their own, second so it is in sight without swiping the chips.
      chip("invited", `Invited ${data.invited.length}`),
      chip("friends", `Friends ${friends}`),
      chip("alliance", `Alliance ${mates}`),
    );

    const box = make("label", "baiter-friends__search");
    box.append(gameIcon("find", { size: 24, decorative: true }));
    const input = make("input", "baiter-friends__search-input");
    input.type = "search";
    input.placeholder = "Find a name";
    input.setAttribute("aria-label", "Find a name");
    input.value = this.search;
    input.addEventListener("input", () => {
      this.search = input.value;
      list.replaceChildren(...this.candidateRows());
      if (list.childElementCount === 0) list.append(make("li", "baiter-friends__empty", "No one by that name."));
    });
    box.append(input);

    const list = make("ul", "baiter-friends__list friends-list");
    list.setAttribute("aria-label", "Friends and alliance mates");
    if (this.filter === "invited") {
      list.append(...this.openRows());
      if (data.invited.length === 0) list.append(make("li", "baiter-friends__empty", "No open invites."));
    } else {
      list.append(...this.candidateRows());
      if (data.candidates.length === 0) {
        list.append(make("li", "baiter-friends__empty", "No friends or alliance mates yet. Add friends in the Friends window."));
      } else if (list.childElementCount === 0) {
        list.append(make("li", "baiter-friends__empty", "No one here."));
      }
    }
    // The chips and the search stay at the top while the list scrolls on a phone.
    const tools = make("div", "baiter-friends__tools");
    tools.append(
      make("p", "baiter__note baiter-friends__lead", "Invited players can test your main yard for 24 h with a free army. Nothing is lost."),
      chips,
      box,
    );
    pick.append(tools, list);

    const side = make("section", "baiter-friends__col baiter-friends__col--open");
    side.setAttribute("aria-label", "Invited");
    const head = make("h3", "baiter-friends__head");
    head.append(gameIcon("time", { size: 24, decorative: true }), `Invited (${data.invited.length})`);
    const open = make("ul", "baiter-friends__list friends-list");
    open.append(...this.openRows());
    if (data.invited.length === 0) open.append(make("li", "baiter-friends__empty", "No open invites."));
    side.append(head, open);

    const foot = make("footer", "baiter-friends__foot");
    const send = iconBtn("mail", "", "primary", "baiter-friends__send");
    send.addEventListener("click", () => void this.send(send));
    this.sendButton = send;
    this.footNote = make("span", "baiter-friends__foot-note");
    foot.append(this.footNote, this.status, send);
    this.invite.replaceChildren(pick, side, foot);
    this.renderPicked();
  }

  /** The foot's count and Send, after a tick: the list stays where it was scrolled. */
  private renderPicked(): void {
    const count = this.picked.size;
    if (this.footNote) this.footNote.textContent = `${count} picked · 24 h, any number of tests`;
    if (this.sendButton) {
      this.sendButton.disabled = count === 0;
      const label = this.sendButton.querySelector("span");
      if (label) label.textContent = `Send ${count}`;
    }
  }

  /** The open invites: time left, tests run, and a cancel. */
  private openRows(): HTMLElement[] {
    return (this.data?.invited ?? []).map((invite) => {
      const cancel = btn("Cancel", "outline", "baiter-friends__cancel");
      cancel.setAttribute("aria-label", `Cancel ${invite.username}'s invite`);
      cancel.title = "Cancel the invite";
      cancel.addEventListener("click", () => void this.cancel(invite.userid, cancel));
      return playerRow(invite, {
        note: `${leftText(invite.expiresAt - this.now())} left · ${invite.tests} ${invite.tests === 1 ? "test" : "tests"}`,
        noteClass: "baiter-friends__open-note",
        actions: [cancel],
      });
    });
  }

  private candidateRows(): HTMLElement[] {
    const data = this.data;
    if (!data) return [];
    const needle = this.search.trim().toLowerCase();
    return data.candidates
      .filter((one) => (this.filter === "friends" ? one.friend : this.filter === "alliance" ? one.alliance : true))
      .filter((one) => needle === "" || one.username.toLowerCase().includes(needle))
      .map((one) => this.candidateRow(one));
  }

  private candidateRow(one: InviteCandidate): HTMLElement {
    const invited = this.data?.invited.some((row) => row.userid === one.userid) ?? false;
    const on = this.picked.has(one.userid);
    const marks: HTMLElement[] = [];
    if (one.alliance) marks.push(figure("alliance", "Alliance mate", "Alliance", "baiter-friends__mate"));
    const actions: HTMLElement[] = [];
    const tick = make("button", "baiter-friends__tick");
    tick.type = "button";
    tick.setAttribute("role", "checkbox");
    tick.setAttribute("aria-label", `Invite ${one.username}`);
    if (!invited) actions.push(tick);
    const row = playerRow(one, { marks, ...(invited ? { note: "Invited" } : {}), actions });
    const show = (picked: boolean): void => {
      tick.classList.toggle("baiter-friends__tick--on", picked);
      tick.textContent = picked ? "✓" : "";
      tick.setAttribute("aria-checked", String(picked));
      row.classList.toggle("baiter-friends__row--on", picked);
    };
    show(on);
    tick.addEventListener("click", () => {
      if (this.picked.has(one.userid)) this.picked.delete(one.userid);
      else if (this.picked.size < (this.data?.maxPerSend ?? 25)) this.picked.add(one.userid);
      show(this.picked.has(one.userid));
      this.renderPicked();
    });
    return row;
  }

  private say(words: string, tone: "good" | "bad", where: HTMLElement = this.status): void {
    where.textContent = words;
    where.className = `baiter-friends__status baiter-friends__status--${tone}`;
  }

  private async send(button: HTMLButtonElement): Promise<void> {
    if (this.picked.size === 0) return;
    button.disabled = true;
    try {
      const sent = await this.api.invite([...this.picked]);
      this.picked.clear();
      await this.load();
      this.say(sent.invited === 1 ? "Invite sent." : `${sent.invited} invites sent.`, "good");
    } catch (error) {
      button.disabled = false;
      this.say(BAITER_REFUSAL_TEXT[baiterRefusalOf(error)], "bad");
    }
  }

  private async cancel(userid: number, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.api.cancel(userid);
      await this.load();
    } catch (error) {
      button.disabled = false;
      this.say(BAITER_REFUSAL_TEXT[baiterRefusalOf(error)], "bad");
    }
  }

  /* ── Invited me ──────────────────────────────────────────────────────── */

  private renderInvitedMe(): void {
    const data = this.data;
    if (!data) return;
    const note = make("p", "baiter__note", "Test their main yard with a free made-up army, up to their Baiter's size. Nothing is lost or won.");
    const list = make("ul", "baiter-friends__list friends-list");
    list.setAttribute("aria-label", "Invites to test a yard");
    for (const invite of data.invitedMe) {
      const test = iconBtn("swords", "Test", "primary", "baiter-friends__test");
      test.setAttribute("aria-label", `Test ${invite.username}'s yard`);
      test.addEventListener("click", () => this.options.onTest(invite));
      list.append(
        playerRow(invite, {
          marks: [
            figure("housing", "Their Baiter's army size", `${formatAmount(invite.cap)} max`, "baiter-friends__cap"),
            figure("time", "Time left", `${leftText(invite.expiresAt - this.now())} left`, "baiter-friends__left"),
          ],
          actions: [test],
        }),
      );
    }
    if (data.invitedMe.length === 0) {
      list.append(make("li", "baiter-friends__empty", "No one has invited you yet. A friend's invite lasts 24 hours."));
    }
    this.invitedMe.replaceChildren(note, list);
  }

  /* ── Results ─────────────────────────────────────────────────────────── */

  private renderResults(): void {
    const data = this.data;
    if (!data) return;
    const testers = new Map<number, { name: string; count: number }>();
    for (const row of data.results) {
      const seen = testers.get(row.tester.userid);
      testers.set(row.tester.userid, { name: row.tester.name, count: (seen?.count ?? 0) + 1 });
    }
    if (this.testerFilter !== null && !testers.has(this.testerFilter)) this.testerFilter = null;
    const children: HTMLElement[] = [];
    if (testers.size > 1) {
      const chips = make("div", "baiter-friends__chips");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Show tests by");
      const chip = (key: number | null, label: string) => {
        const node = btn(label, this.testerFilter === key ? "primary" : "outline", "baiter-friends__chip");
        node.setAttribute("aria-pressed", String(this.testerFilter === key));
        node.addEventListener("click", () => {
          this.testerFilter = key;
          this.renderResults();
        });
        return node;
      };
      chips.append(chip(null, `All ${data.results.length}`));
      for (const [userid, { name, count }] of testers) chips.append(chip(userid, `${name} ${count}`));
      children.push(chips);
    }
    const list = make("ul", "baiter-friends__list friends-list");
    list.setAttribute("aria-label", "Tests of your yard");
    for (const row of data.results) {
      if (this.testerFilter !== null && row.tester.userid !== this.testerFilter) continue;
      list.append(this.resultRow(row));
    }
    if (data.results.length === 0) {
      list.append(make("li", "baiter-friends__empty", "No tests of your yard yet. Invite friends on the Invite tab."));
    }
    children.push(list, this.resultsStatus, make("p", "baiter__note baiter-friends__keep", "Kept 7 days. Real attacks stay in Defences."));
    if (this.options.ownTests) children.push(this.options.ownTests);
    this.results.replaceChildren(...children);
  }

  private resultRow(row: FriendTestRow): HTMLElement {
    const result = make("span", `baiter-friends__result baiter-friends__result--${row.result}`, RESULT_WORDS[row.result]);
    const damage = figure("yarddamage", "Damage", `${Math.floor(row.damage)}%`, "baiter-friends__damage");
    const fresh = row.foughtAt > this.seen;
    const actions: HTMLElement[] = [];
    if (this.options.onWatch) {
      const watch = iconBtn("camera", "Watch", "outline", "baiter-friends__watch");
      watch.setAttribute("aria-label", `Watch ${row.tester.name}'s test`);
      if (!row.playable) {
        watch.disabled = true;
        watch.title = row.hasReplay ? DEFENCE_REFUSAL_TEXT.update : DEFENCE_REFUSAL_TEXT.missing;
      }
      watch.addEventListener("click", () => void this.open(row, watch, "watch"));
      actions.push(watch);
    }
    if (this.options.onReport) {
      // Words only: the flag icon is the game's "report a player".
      const report = btn("Report", "outline", "baiter-friends__report");
      report.setAttribute("aria-label", `${row.tester.name}'s test: the report`);
      report.addEventListener("click", () => void this.open(row, report, "report"));
      actions.push(report);
    }
    const item = playerRow(
      { userid: row.tester.userid, username: row.tester.name, pic: row.tester.pic, photo: row.tester.photo ?? null, level: row.tester.level ?? 0 },
      {
        note: `${agoText(this.now() - row.foughtAt)} · ${lengthText(row.seconds)}`,
        marks: [...(fresh ? [make("span", "baiter-friends__new", "New")] : []), result, damage],
        actions,
      },
    );
    if (fresh) item.classList.add("baiter-friends__row--new");
    return item;
  }

  private async open(row: FriendTestRow, button: HTMLButtonElement, what: "watch" | "report"): Promise<void> {
    button.disabled = true;
    try {
      const answer = await this.api.replay(row.id);
      const run = ownerRunOf(answer);
      if (what === "watch") {
        if (run) this.options.onWatch?.(run);
        else this.say(DEFENCE_REFUSAL_TEXT.update, "bad", this.resultsStatus);
      } else {
        this.options.onReport?.(reportOf(answer.test, answer.replay.report), run);
      }
    } catch (error) {
      const refusal = baiterRefusalOf(error);
      // No replay kept: the report still shows the list's figures.
      if (what === "report" && refusal === "noReplay") this.options.onReport?.(reportOf(row, null), null);
      else this.say(BAITER_REFUSAL_TEXT[refusal], "bad", this.resultsStatus);
    } finally {
      button.disabled = false;
    }
  }
}
