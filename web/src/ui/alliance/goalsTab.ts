import type { AllianceResult, MyAlliance } from "@/api/alliance";
import type { GoalMenuItem, GoalView } from "@/api/allianceProgress";
import { classicLook } from "@/game/classicLook";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { make } from "@/ui/friends/rows";
import { Popup } from "@/ui/Popup";

/**
 * The Alliance window's Goals tab (owner, 15 Nov 2026): the week's goals as
 * roomy cards (painted icon, full name, a wide bar with a short count inside,
 * ★ and the tier on the right, a small × for the Leader and Officers), and a
 * full-tab list for adding one, every kind in one scroll with an Easy, Medium
 * and Hard button each. A kind used this week is greyed. The Overview shows
 * one line of it instead ({@link goalsLine}). Pure DOM builders; the window
 * (`AllianceWindow.ts`) owns the state and the calls.
 */

export const GOALS_TEXT = {
  tab: "Goals",
  add: "Add",
  addTitle: "Add goal",
  back: "Back",
  empty: "No goals yet this week.",
  emptyLead: "No goals yet this week. Add up to 5.",
  used: "Used",
  usedTitle: "Used this week: try again next week",
  full: (of: number): string => `All ${of} set this week`,
  done: "Done",
  remove: "Remove",
  removeLabel: (name: string): string => `Remove ${name}`,
  removeTitle: "Remove goal?",
  removeLost: (count: string): string => `Its progress is lost (${count}).`,
  removeOnce: "It can't be set again this week.",
  cancel: "Cancel",
  slots: (set: number, of: number): string => `${set} of ${of} goals set this week`,
  endsIn: (left: string): string => `Week ends in ${left}`,
  line: (done: number, set: number, points: number, left: string): string =>
    `Goals: ${done} of ${set} done, ${points} points, week ends in ${left}`,
} as const;

/** Each kind's painted icon (`gameIcon.ts`); a kind not listed shows the alliance shield. */
export const GOAL_ICONS: Readonly<Record<string, GameIconName>> = {
  tribeDestroy: "yarddamage2",
  takeover: "height",
  hold: "neighbours",
  attackWin: "swords",
  defenceWin: "shield",
  dailyQuests: "event",
  loot: "resourcebomb",
  catapultHit: "range2",
  upgrade: "levelup",
  harvest: "income",
  kitRebuild: "tools",
  outpostDefended: "neighbours2",
};

export const goalIcon = (kind: string): GameIconName => GOAL_ICONS[kind] ?? "alliance";

/** The Goals tab's own icon: the archery target, painted for each look. */
export const goalsTabIcon = (): GameIconName => (classicLook() ? "goalsclassic" : "goals");

const TIER_WORDS: Readonly<Record<GoalView["tier"], string>> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export const tierWord = (tier: GoalView["tier"]): string => TIER_WORDS[tier] ?? tier;

const UNITS: readonly [number, string][] = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "K"],
];

/**
 * A goal target short enough for a button, never rounded: "450M", "2.25B",
 * "18K", "90" (up to two decimals, trailing zeros dropped).
 */
export const shortTarget = (value: number): string => {
  for (const [unit, word] of UNITS) {
    if (value >= unit && Number.isInteger((value * 100) / unit)) return `${(value / unit).toFixed(2).replace(/\.?0+$/, "")}${word}`;
  }
  return formatAmount(value);
};

/**
 * Progress short enough for the bar, always rounded DOWN so a goal never
 * looks done early: 2,249,999,999 is "2.24B", not "2.25B" (owner, 15 Nov).
 * Up to two decimals of B, one of M and K; under 10,000 exact.
 */
export const shortCount = (value: number): string => {
  const n = Math.max(0, Math.floor(value));
  if (n < 10_000) return formatAmount(n);
  for (const [unit, word] of UNITS) {
    if (n < unit) continue;
    const places = unit === 1_000_000_000 ? 100 : 10;
    const scaled = Math.floor((n / unit) * places + 1e-9) / places;
    return `${scaled.toFixed(unit === 1_000_000_000 ? 2 : 1).replace(/\.?0+$/, "")}${word}`;
  }
  return formatAmount(n);
};

/** "1.2B / 2.25B": the count inside a goal's bar. */
export const goalCount = (goal: Pick<GoalView, "progress" | "target">): string =>
  `${shortCount(Math.min(goal.progress, goal.target))} / ${shortTarget(goal.target)}`;

const canLead = (alliance: MyAlliance): boolean => alliance.role === "leader" || alliance.role === "officer";

const button = (className: string, run: () => void, ...children: (Node | string)[]): HTMLButtonElement => {
  const node = make("button", `btn ${className}`);
  node.type = "button";
  node.append(...children);
  node.addEventListener("click", () => run());
  return node;
};

const iconWith = (name: GameIconName, size: 16 | 24 | 32, text: string, className: string): HTMLElement => {
  const node = make("span", className);
  node.append(gameIcon(name, { size, decorative: true }), make("span", "", text));
  return node;
};

/** What the tab needs from the window. */
export interface GoalsHost {
  /** Runs a call, shows a refusal, and reloads the alliance on success. */
  run(action: () => Promise<AllianceResult<object>>): void;
  /** Unix seconds now. */
  now(): number;
  /** Whether the Add list is showing in place of the cards. */
  adding(): boolean;
  /** Opens or closes the Add list. */
  setAdding(open: boolean): void;
  /** Asks before removing a goal; true to remove. */
  confirmRemove(goal: GoalView): Promise<boolean>;
}

export interface GoalsApi {
  setGoal(kind: string, tier: GoalView["tier"]): Promise<AllianceResult<object>>;
  removeGoal(id: number): Promise<AllianceResult<object>>;
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** One goal: icon, name, a wide bar with its count, ★ and tier, and × for the Leader and Officers. */
export const goalCard = (goal: GoalView, lead: boolean, remove: () => void): HTMLElement => {
  const card = make("article", `alliance-goal alliance-goal--${goal.tier}${goal.done ? " alliance-goal--done" : ""}`);
  card.dataset["kind"] = goal.kind;
  const icon = gameIcon(goalIcon(goal.kind), { size: 32, decorative: true, className: "alliance-goal__icon" });

  const bar = make("div", "alliance-goal__bar");
  const share = Math.min(1, goal.progress / Math.max(1, goal.target));
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(goal.target));
  bar.setAttribute("aria-valuenow", String(Math.min(goal.progress, goal.target)));
  bar.setAttribute("aria-label", goal.name);
  const fill = make("span", "alliance-goal__fill");
  // Floor, so 99.9% never draws as a full bar.
  fill.style.width = `${goal.done ? 100 : Math.floor(share * 100)}%`;
  bar.append(fill, make("span", "alliance-goal__count", goalCount(goal)));

  const pay = make("span", "alliance-goal__pay", `${goal.done ? "✓" : "★"} ${formatAmount(goal.points)}`);
  pay.title = goal.done ? GOALS_TEXT.done : `★ ${formatAmount(goal.points)}`;
  const tier = make("span", `alliance-goal__tier alliance-goal__tier--${goal.tier}`, tierWord(goal.tier));

  card.append(icon, make("span", "alliance-goal__name", goal.name), pay, bar, tier);
  if (lead && goal.removable && !goal.done) {
    const cross = button("btn--ghost alliance-goal__remove", remove, make("span", "alliance-goal__cross", "×"));
    cross.setAttribute("aria-label", GOALS_TEXT.removeLabel(goal.name));
    cross.title = GOALS_TEXT.remove;
    card.append(cross);
  } else {
    card.classList.add("alliance-goal--locked");
  }
  return card;
};

/** The tab: a strip (goals set, week ends, Add), then the cards; or the Add list. */
export const goalsTab = (alliance: MyAlliance, host: GoalsHost, api: GoalsApi): HTMLElement[] => {
  const goals = alliance.goals ?? [];
  const of = alliance.goals_per_week ?? 5;
  const lead = canLead(alliance);
  const room = of - goals.length;
  if (host.adding() && lead && room > 0) return [goalPicker(alliance, host, api)];

  const strip = make("div", "alliance-goals__strip");
  const set = iconWith(goalsTabIcon(), 24, `${goals.length}/${of}`, "alliance-goals__slots");
  set.title = GOALS_TEXT.slots(goals.length, of);
  set.setAttribute("aria-label", GOALS_TEXT.slots(goals.length, of));
  strip.append(set);
  const endsIn = (alliance.week_ends_at ?? 0) - host.now();
  if (endsIn > 0) {
    const ends = iconWith("time", 24, formatCountdown(endsIn), "alliance-goals__ends");
    ends.title = GOALS_TEXT.endsIn(formatCountdown(endsIn));
    ends.setAttribute("aria-label", GOALS_TEXT.endsIn(formatCountdown(endsIn)));
    strip.append(ends);
  }
  if (lead && room > 0) {
    strip.append(button("btn--primary alliance-goals__add", () => host.setAdding(true), make("span", "alliance-goals__plus", "+"), make("span", "", GOALS_TEXT.add)));
  }

  const list = make("div", `alliance-goals${lead ? "" : " alliance-goals--member"}`);
  if (goals.length === 0) list.append(make("p", "alliance-goals__empty", lead ? GOALS_TEXT.emptyLead : GOALS_TEXT.empty));
  for (const goal of goals) {
    list.append(
      goalCard(goal, lead, () => {
        void host.confirmRemove(goal).then((yes) => {
          if (yes) host.run(() => api.removeGoal(goal.id));
        });
      }),
    );
  }
  return [strip, list];
};

// ---------------------------------------------------------------------------
// The Add list
// ---------------------------------------------------------------------------

/** Whether a kind cannot be set this week: set now, or set and removed (the server says `used`). */
const usedThisWeek = (item: GoalMenuItem, goals: readonly GoalView[]): boolean =>
  item.used === true || goals.some((g) => g.kind === item.kind);

/** Every kind in one scroll, each with Easy / Medium / Hard; Back returns to the cards. */
export const goalPicker = (alliance: MyAlliance, host: GoalsHost, api: GoalsApi): HTMLElement => {
  const goals = alliance.goals ?? [];
  const of = alliance.goals_per_week ?? 5;
  const box = make("section", "goal-picker");
  const head = make("div", "goal-picker__head");
  const back = button("btn--outline goal-picker__back", () => host.setAdding(false), `← ${GOALS_TEXT.back}`);
  const slots = iconWith(goalsTabIcon(), 24, `${goals.length}/${of}`, "goal-picker__slots");
  slots.title = GOALS_TEXT.slots(goals.length, of);
  slots.setAttribute("aria-label", GOALS_TEXT.slots(goals.length, of));
  head.append(back, make("h3", "goal-picker__title", GOALS_TEXT.addTitle), slots);
  box.append(head);

  const menu = alliance.goal_menu ?? [];
  const tiers = menu[0]?.tiers ?? [];
  if (tiers.length > 0) {
    // Per tier, once: only its word (owner, 25 Nov 2026: no player count).
    const cols = make("div", "goal-picker__cols");
    cols.append(make("span", "goal-picker__cols-gap"));
    for (const tier of tiers) {
      const col = make("span", `goal-picker__col goal-picker__col--${tier.tier}`);
      col.append(make("strong", "goal-picker__col-tier", tierWord(tier.tier)));
      cols.append(col);
    }
    box.append(cols);
  }

  const list = make("div", "goal-picker__list");
  // The kinds that can still be set first; the used ones, greyed, after them.
  const ordered = [...menu.filter((item) => !usedThisWeek(item, goals)), ...menu.filter((item) => usedThisWeek(item, goals))];
  for (const item of ordered) {
    const used = usedThisWeek(item, goals);
    const row = make("div", `goal-pick${used ? " goal-pick--used" : ""}${item.only ? " goal-pick--only" : ""}`);
    row.dataset["kind"] = item.kind;
    const name = make("span", "goal-pick__name");
    name.append(gameIcon(goalIcon(item.kind), { size: 32, decorative: true }), make("span", "goal-pick__words", item.name));
    if (used) {
      const tag = make("span", "goal-pick__used", GOALS_TEXT.used);
      tag.title = GOALS_TEXT.usedTitle;
      name.append(tag);
    }
    row.append(name);
    for (const tier of item.tiers) {
      const pick = button(
        `btn--outline goal-pick__tier goal-pick__tier--${tier.tier}`,
        () => host.run(() => api.setGoal(item.kind, tier.tier)),
        make("span", "goal-pick__target", shortTarget(tier.target)),
        make("span", "goal-pick__stars", `★${formatAmount(tier.points)}`),
      );
      pick.disabled = used;
      pick.title = used ? GOALS_TEXT.usedTitle : `${tierWord(tier.tier)}: ${formatAmount(tier.target)} · ★ ${formatAmount(tier.points)}`;
      pick.setAttribute("aria-label", `${item.name}, ${tierWord(tier.tier)} ${formatAmount(tier.target)}, ${formatAmount(tier.points)} points`);
      row.append(pick);
    }
    list.append(row);
  }
  box.append(list);
  return box;
};

// ---------------------------------------------------------------------------
// The Overview's one line, and the remove pop-up
// ---------------------------------------------------------------------------

/** "🎯 2/5 · ★ 52 · ⌛ 3d 4h ›": goals done of set, points from them, week left. Opens the Goals tab. */
export const goalsLine = (alliance: MyAlliance, now: number, open: () => void): HTMLElement | null => {
  const goals = alliance.goals;
  if (!goals) return null;
  const done = goals.filter((g) => g.done);
  const points = done.reduce((sum, g) => sum + g.points, 0);
  const left = formatCountdown(Math.max(0, (alliance.week_ends_at ?? 0) - now));
  const line = button(
    "btn--ghost alliance-goals-line",
    open,
    iconWith(goalsTabIcon(), 24, `${done.length}/${goals.length}`, "alliance-goals-line__part alliance-goals-line__done"),
    make("span", "alliance-goals-line__part alliance-goals-line__stars", `★ ${formatAmount(points)}`),
  );
  if ((alliance.week_ends_at ?? 0) > now) line.append(iconWith("time", 24, left, "alliance-goals-line__part alliance-goals-line__ends"));
  line.append(make("span", "alliance-goals-line__go", "›"));
  const words = GOALS_TEXT.line(done.length, goals.length, points, left);
  line.setAttribute("aria-label", words);
  line.title = words;
  return line;
};

/**
 * Asks before a goal goes. Its progress is lost, said with the count; Hold's
 * comes from the territory tally, so its pop-up does not say so (owner, 15
 * Nov). Either way the kind cannot be set again this week. True on Remove;
 * false on Cancel, Escape or the scrim.
 */
export const confirmRemoveGoal = (container: HTMLElement, goal: GoalView): Promise<boolean> =>
  new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const popup = new Popup({
      title: GOALS_TEXT.removeTitle,
      className: "takeover-dialog goal-remove-dialog",
      onClose: () => answer(false),
    });
    const what = make("p", "goal-remove-dialog__goal");
    what.append(gameIcon(goalIcon(goal.kind), { size: 32, decorative: true }), make("strong", "", goal.name));
    const lines: HTMLElement[] = [];
    if (goal.kind !== "hold") lines.push(make("p", "takeover-dialog__lead goal-remove-dialog__lost", GOALS_TEXT.removeLost(goalCount(goal))));
    lines.push(make("p", "takeover-dialog__lead goal-remove-dialog__once", GOALS_TEXT.removeOnce));
    const cancel = make("button", "btn btn--ghost", GOALS_TEXT.cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => popup.close());
    const go = make("button", "btn btn--danger goal-remove-dialog__go", GOALS_TEXT.remove);
    go.type = "button";
    go.addEventListener("click", () => {
      answer(true);
      popup.close();
    });
    const actions = make("div", "takeover-dialog__actions");
    actions.append(cancel, go);
    popup.setContent(what, ...lines, actions);
    popup.mount(container);
  });
