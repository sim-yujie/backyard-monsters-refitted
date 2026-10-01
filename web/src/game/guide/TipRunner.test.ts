// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Onboarding } from "@/api/types";
import type { GuideStep } from "@/ui/guide/GuideOverlay";
import { GuideBus, GuideScreen } from "./guideBus";
import { clearCanvasTargets, findTarget, tutTarget, TutTarget } from "./targets";
import type { Tip } from "./tipsCatalogue";
import { TipRunner, type TipView } from "./TipRunner";

/** Bob's screen tips, run: when they show, "seen", pausing, "?" (issue #227, §7.1). */

/** jsdom lays nothing out: everything has a size unless marked `data-zero`. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const size = this.hasAttribute("data-zero") ? 0 : 40;
    return { left: 10, top: 300, width: size, height: size, right: 10 + size, bottom: 300 + size, x: 10, y: 300, toJSON: () => ({}) };
  });
});

afterEach(() => {
  runner?.destroy();
  runner = null;
  document.body.replaceChildren();
  clearCanvasTargets();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const onboarding = (state: Onboarding["guide"]["state"], tips: Record<string, number> = {}): Onboarding => ({
  guide: { state },
  camp: "none",
  goalsReady: 0,
  tips,
});

/** A view that remembers what it was shown. */
class FakeView implements TipView {
  shown: GuideStep | null = null;
  attached = true;
  destroyed = false;
  show(step: GuideStep): void {
    this.shown = step;
  }
  hide(): void {
    this.shown = null;
  }
  destroy(): void {
    this.destroyed = true;
    this.shown = null;
  }
  /** Presses a button in the bubble by its label. */
  press(label: string): void {
    const step = this.shown;
    if (!step) throw new Error("nothing on screen");
    if (step.skip?.label === label) return step.skip.onClick();
    const action = step.actions?.find((one) => one.label === label);
    if (!action) throw new Error(`no ${label} in ${JSON.stringify(step.actions?.map((one) => one.label))}`);
    action.onClick();
  }
}

let runner: TipRunner | null = null;

/** Two screens' worth of made-up tips, so the tests do not hang on the real wording. */
const TEST_TIPS: Partial<Record<GuideScreen, readonly Tip[]>> = {
  [GuideScreen.YARD]: [
    { text: "{Tap} Collect all.", target: TutTarget.COLLECT_ALL },
    { text: "Build is here.", target: TutTarget.DOCK_BUILD },
    { text: "Goals are here.", target: TutTarget.DOCK_GOALS },
  ],
  [GuideScreen.BUILD]: [{ text: "Locked ones say why.", target: { selector: ".tile--locked" } }],
  [GuideScreen.BUILDING]: [{ text: "Upgrade.", target: TutTarget.UPGRADE }],
  [GuideScreen.REPAIR]: [{ text: "Repair.", target: [TutTarget.REPAIR, TutTarget.REPAIR_ALL] }],
  [GuideScreen.MAIL]: [
    { text: "Threads.", target: TutTarget.MAIL_THREADS },
    { text: "Nothing to point at." },
  ],
  [GuideScreen.MR2]: [{ text: "Range.", target: TutTarget.MR2_RANGE }],
};

const setup = (options: { touch?: boolean; send?: (screen: GuideScreen) => Promise<unknown> } = {}) => {
  const bus = new GuideBus();
  const views: FakeView[] = [];
  const send = vi.fn(options.send ?? (() => Promise.resolve()));
  runner = new TipRunner({
    bus,
    send,
    createView: () => {
      const view = new FakeView();
      views.push(view);
      return view;
    },
    touch: () => options.touch ?? false,
    tips: (screen) => TEST_TIPS[screen] ?? [],
  });
  const view = (): FakeView | undefined => views.at(-1);
  return { bus, send, views, view, runner };
};

/** An element on screen, appended to `parent`. */
const box = (parent: HTMLElement = document.body, className = ""): HTMLElement => {
  const element = document.createElement("div");
  element.className = className;
  parent.append(element);
  return element;
};

const control = (name: string, parent: HTMLElement = document.body): HTMLElement =>
  tutTarget(box(parent), name);

/** A panel with a title row and a close button, like `Panel`. */
const panel = (): { root: HTMLElement; header: HTMLElement } => {
  const root = box(document.body, "panel");
  const header = document.createElement("header");
  header.className = "panel__titlebar";
  const close = document.createElement("button");
  close.setAttribute("aria-label", "Close Build");
  header.append(close);
  root.append(header);
  return { root, header };
};

/** The yard as the tips see it: the content layer with Collect all and Build. */
const yard = () => {
  const root = box(document.body, "overlay__layer");
  control(TutTarget.COLLECT_ALL, root);
  control(TutTarget.DOCK_BUILD, root);
  return root;
};

const settle = async (ms = 500): Promise<void> => {
  await Promise.resolve();
  vi.advanceTimersByTime(ms);
};

describe("when tips show by themselves", () => {
  it("not before the yard has said what the account's record is", async () => {
    const { bus, view } = setup();
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()).toBeUndefined();
  });

  it("never while the guided start is to run or running", async () => {
    for (const state of ["pending", "active"] as const) {
      const { bus, view, runner: tips } = setup();
      tips.setOnboarding(onboarding(state));
      bus.emit("screen", { id: GuideScreen.MAIL, root: box(), header: null });
      await settle();
      expect(view()?.shown ?? null).toBeNull();
      tips.destroy();
    }
  });

  it("a skipper gets the yard's tips, a step at a time, leaving out a target that is not there", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });

    // Not at once: the screen lays out first.
    await settle(100);
    expect(view()).toBeUndefined();
    await settle(400);

    // Goals is not on the dock, so two tips, not three.
    expect(view()!.shown).toMatchObject({
      text: "Click Collect all.",
      icon: true,
      block: false,
      target: TutTarget.COLLECT_ALL,
      dots: { index: 0, count: 2 },
      skip: { label: "Skip tips" },
    });
    view()!.press("Next");
    expect(view()!.shown).toMatchObject({ text: "Build is here.", dots: { index: 1, count: 2 } });
    expect(send).not.toHaveBeenCalled();

    view()!.press("Got it");
    expect(send).toHaveBeenCalledWith(GuideScreen.YARD);
    expect(view()!.destroyed).toBe(true);
  });

  it("says tap on a touch screen", async () => {
    const { bus, view, runner: tips } = setup({ touch: true });
    tips.setOnboarding(onboarding("legacy"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()!.shown!.text).toBe("Tap Collect all.");
  });

  it("a legacy account counts as one that never had the guided start: every screen", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("legacy"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()!.shown).not.toBeNull();
  });

  it("a player who finished the guided start gets no tips on the screens it taught, but gets the rest", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("done"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()).toBeUndefined();

    const mail = box();
    control(TutTarget.MAIL_THREADS, mail);
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    await settle();
    expect(view()!.shown).toMatchObject({ text: "Threads." });
    // A tip with no target shows, without the hand.
    view()!.press("Next");
    expect(view()!.shown).toMatchObject({ text: "Nothing to point at.", target: null });
  });

  it("not for a screen the server says was seen, nor twice in one sitting", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped", { yard: 5 }));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()).toBeUndefined();

    const mail = box();
    control(TutTarget.MAIL_THREADS, mail);
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    await settle();
    view()!.press("Skip tips");
    expect(send).toHaveBeenCalledWith(GuideScreen.MAIL);

    // The answer has not been merged yet; the runner remembers anyway.
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    await settle();
    expect(view()!.shown).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a failed request is not an error, and the screen still counts as seen", async () => {
    const { bus, view, runner: tips } = setup({ send: () => Promise.reject(new Error("offline")) });
    tips.setOnboarding(onboarding("skipped"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    view()!.press("Skip tips");
    await Promise.resolve();
    expect(tips.isSeen(GuideScreen.YARD)).toBe(true);
  });

  it("a screen whose tips have nothing on screen to point at shows none, and is not marked", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    bus.emit("screen", { id: GuideScreen.BUILDING, root: box(), header: null });
    await settle();
    expect(view()).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("starts the open screens' tips when the guided start ends", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("active"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()).toBeUndefined();

    tips.setOnboarding(onboarding("skipped"));
    await settle();
    expect(view()!.shown).toMatchObject({ text: "Click Collect all." });
  });

  it("stops unseen tips when the guided start begins", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("legacy"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    tips.setOnboarding(onboarding("active"));
    expect(view()!.destroyed).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("selector targets", () => {
  it("points at an untagged control by a selector inside the screen", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    const menu = box();
    const locked = box(menu, "tile tile--locked");
    bus.emit("screen", { id: GuideScreen.BUILD, root: menu, header: null });
    await settle();

    const target = view()!.shown!.target!;
    expect(target).toBe("tip:");
    expect(findTarget(target)?.rect).toEqual({ left: 10, top: 300, width: 40, height: 40 });
    locked.setAttribute("data-zero", "");
    expect(findTarget(target)).toBeNull();
  });

  it("brings a control scrolled out of view into it", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    const mail = box();
    const threads = control(TutTarget.MAIL_THREADS, mail);
    const scroll = vi.fn();
    threads.scrollIntoView = scroll;
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    await settle();

    const found = view()!.shown!.onTargetFound!;
    found({ left: 10, top: 300, width: 40, height: 40 });
    expect(scroll).not.toHaveBeenCalled();
    found({ left: 10, top: window.innerHeight + 100, width: 40, height: 40 });
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("tries a tip's targets in order", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    const { root } = panel();
    control(TutTarget.REPAIR_ALL);
    bus.emit("screen", { id: GuideScreen.REPAIR, root, header: null });
    await settle();
    expect(view()!.shown!.target).toBe(TutTarget.REPAIR_ALL);
  });
});

describe("seen when the player moves on", () => {
  it("closing the screen while a tip is up marks it seen; before one showed, it does not", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    const mail = box();
    control(TutTarget.MAIL_THREADS, mail);

    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    mail.hidden = true;
    await settle();
    expect(view()).toBeUndefined();

    mail.hidden = false;
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    await settle();
    expect(view()!.shown).not.toBeNull();
    mail.remove();
    await settle(300);
    expect(send).toHaveBeenCalledWith(GuideScreen.MAIL);
    expect(view()!.destroyed).toBe(true);
  });

  it("a new scene (the overlay cleared under the tips) ends them, marking what showed", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    view()!.attached = false;

    const map = box();
    control(TutTarget.MR2_RANGE, map);
    bus.emit("screen", { id: GuideScreen.MR2, root: map, header: null });
    expect(send).toHaveBeenCalledWith(GuideScreen.YARD);
    await settle();
    expect(view()!.shown).toMatchObject({ text: "Range." });
  });

  it("a replay never marks anything seen", async () => {
    const { send, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("done"));
    const root = yard();
    tips.replay([{ screen: GuideScreen.YARD, root }]);
    await settle(0);
    expect(view()!.shown).toMatchObject({ skip: { label: "Close" } });
    view()!.press("Next");
    view()!.press("Next");
    view()!.press("Got it");
    root.remove();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("more than one screen", () => {
  it("a panel over the yard pauses the yard's tips, which resume where they were", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    view()!.press("Next");

    const mail = box();
    control(TutTarget.MAIL_THREADS, mail);
    bus.emit("screen", { id: GuideScreen.MAIL, root: mail, header: null });
    // The yard's tip stays up until the mail's start.
    expect(view()!.shown).toMatchObject({ text: "Build is here." });
    await settle();
    expect(view()!.shown).toMatchObject({ text: "Threads." });
    view()!.press("Skip tips");

    expect(view()!.shown).toMatchObject({ text: "Build is here.", dots: { index: 1, count: 2 } });
  });

  it("screens that open together take turns: the building panel, then its repair", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    const { root, header } = panel();
    control(TutTarget.UPGRADE, root);
    control(TutTarget.REPAIR, root);
    bus.emit("screen", { id: GuideScreen.BUILDING, root, header });
    bus.emit("screen", { id: GuideScreen.REPAIR, root, header });
    await settle();

    expect(view()!.shown).toMatchObject({ text: "Upgrade." });
    view()!.press("Got it");
    expect(view()!.shown).toMatchObject({ text: "Repair." });
    view()!.press("Got it");
    expect(send.mock.calls.map(([screen]) => screen)).toEqual([GuideScreen.BUILDING, GuideScreen.REPAIR]);
  });

  it("hides while something blocks it (the planner) and comes back after", async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("skipped"));
    let planner = false;
    tips.setBlocked(() => planner);
    bus.emit("screen", { id: GuideScreen.YARD, root: yard(), header: null });
    await settle();
    expect(view()!.shown).not.toBeNull();

    planner = true;
    await settle(300);
    expect(view()!.shown).toBeNull();
    planner = false;
    await settle(300);
    expect(view()!.shown).toMatchObject({ text: "Click Collect all." });
  });
});

describe('the "?" button', () => {
  it("sits before a title row's close button and replays the screen's tips, marking nothing", async () => {
    const { bus, view, send, runner: tips } = setup();
    tips.setOnboarding(onboarding("done", { mail: 3 }));
    const { root, header } = panel();
    control(TutTarget.MAIL_THREADS, root);
    bus.emit("screen", { id: GuideScreen.MAIL, root, header });
    await settle();
    expect(view()).toBeUndefined();

    const help = header.querySelector<HTMLButtonElement>(".guide-help")!;
    expect(help.nextElementSibling?.getAttribute("aria-label")).toBe("Close Build");
    expect(help.textContent).toBe("?");
    help.click();
    await settle(0);
    expect(view()!.shown).toMatchObject({ text: "Threads." });
    view()!.press("Close");
    expect(send).not.toHaveBeenCalled();
  });

  it("replays every tip, the ones whose control is not on screen without the hand", async () => {
    const { view, runner: tips } = setup();
    tips.setOnboarding(onboarding("done"));
    const root = box();
    tips.replay([{ screen: GuideScreen.BUILD, root }]);
    await settle(0);
    expect(view()!.shown).toMatchObject({ text: "Locked ones say why.", target: "tip:" });
    expect(findTarget("tip:")).toBeNull();
  });

  it("floats over a screen with no title row, and is only added once", async () => {
    const { bus, runner: tips } = setup();
    tips.setOnboarding(onboarding("done"));
    const root = yard();
    bus.emit("screen", { id: GuideScreen.YARD, root, header: null });
    bus.emit("screen", { id: GuideScreen.YARD, root, header: null });
    expect(root.querySelectorAll(".guide-help--float")).toHaveLength(1);
  });

  it("is hidden while the guided start runs", () => {
    const { bus, runner: tips } = setup();
    tips.setOnboarding(onboarding("active"));
    const { root, header } = panel();
    bus.emit("screen", { id: GuideScreen.MAIL, root, header });
    const help = header.querySelector<HTMLButtonElement>(".guide-help")!;
    expect(help.hidden).toBe(true);
    tips.setOnboarding(onboarding("done"));
    expect(help.hidden).toBe(false);
  });

  it('a panel inside the building panel shares its "?", which replays both', async () => {
    const { bus, view, runner: tips } = setup();
    tips.setOnboarding(onboarding("done", { building: 1, repair: 1 }));
    const { root, header } = panel();
    control(TutTarget.UPGRADE, root);
    control(TutTarget.REPAIR, root);
    bus.emit("screen", { id: GuideScreen.BUILDING, root, header });
    const inner = box(root);
    bus.emit("screen", { id: GuideScreen.REPAIR, root: inner, header: null });
    expect(header.querySelectorAll(".guide-help")).toHaveLength(1);

    header.querySelector<HTMLButtonElement>(".guide-help")!.click();
    await settle(0);
    expect(view()!.shown).toMatchObject({ text: "Upgrade." });
    view()!.press("Got it");
    expect(view()!.shown).toMatchObject({ text: "Repair." });
  });

  it("no button for a screen with no tips", () => {
    const { bus, runner: tips } = setup();
    tips.setOnboarding(onboarding("done"));
    const { root, header } = panel();
    bus.emit("screen", { id: GuideScreen.PLANNER, root, header });
    expect(header.querySelector(".guide-help")).toBeNull();
  });
});
