// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import { YardAttackWatch } from "@/game/presence/yardAttack";
import { UnderAttackLock, underAttackCountdown, underAttackTitle } from "@/ui/yard/UnderAttackLock";
import { isUnderAttackRefusal, RETRY_RELOAD_MS, YardAttackGuard, type AttackLockView } from "./yardAttackGuard";

/**
 * The own yard while it is attacked (#275): a banner naming the attacker, the
 * yard locked, and a reload once the attack ends.
 */

const NOW_S = 1_900_000_000;

let checks: number;
let reloads: number;
let watch: YardAttackWatch;
let view: AttackLockView & { readonly state: { by: string | null; ends: number | null } | null };

const makeView = () => {
  const box = { state: null as { by: string | null; ends: number | null } | null };
  return Object.assign(box, {
    show: (by: string | null, ends: number | null) => {
      box.state = { by, ends };
    },
    hide: () => {
      box.state = null;
    },
  });
};

const guard = () =>
  new YardAttackGuard({
    watch,
    view,
    reload: () => {
      reloads += 1;
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  checks = 0;
  reloads = 0;
  watch = new YardAttackWatch({ check: () => (checks += 1) });
  view = makeView();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("YardAttackGuard", () => {
  it("locks with the attacker's name when the ping says so, and reloads once the attack is over", () => {
    const yard = guard();
    watch.hear({ now: NOW_S });
    expect(yard.locked).toBe(false);

    watch.hear({ now: NOW_S, attack: { by: "Raider", ends: NOW_S + 400 } });
    expect(yard.locked).toBe(true);
    expect(view.state).toEqual({ by: "Raider", ends: NOW_S + 400 });
    expect(reloads).toBe(0);

    watch.hear({ now: NOW_S + 60 });
    expect(yard.locked).toBe(false);
    expect(view.state).toBeNull();
    expect(reloads).toBe(1);
    yard.destroy();
  });

  it("opens locked when the attack is already known", () => {
    watch.hear({ now: NOW_S, attack: { by: "Raider", ends: NOW_S + 400 } });
    const yard = guard();
    expect(yard.locked).toBe(true);
    expect(view.state?.by).toBe("Raider");
    yard.destroy();
    expect(view.state).toBeNull();
  });

  it("a refused request locks at once and asks the server, which then names the attacker", () => {
    const yard = guard();
    yard.refused();
    expect(yard.locked).toBe(true);
    expect(view.state).toEqual({ by: null, ends: null });
    expect(checks).toBe(1);
    watch.hear({ now: NOW_S, attack: { by: "Raider", ends: NOW_S + 400 } });
    expect(view.state?.by).toBe("Raider");
    // An attack the answers know of ends by itself, not by the retry.
    vi.advanceTimersByTime(RETRY_RELOAD_MS * 2);
    expect(reloads).toBe(0);
    watch.hear({ now: NOW_S + 60 });
    expect(reloads).toBe(1);
    yard.destroy();
  });

  it("an attack the ping does not know of (an outpost's) tries loading again until it goes through", () => {
    const yard = guard();
    yard.refused();
    watch.hear({ now: NOW_S });
    expect(yard.locked).toBe(true);
    vi.advanceTimersByTime(RETRY_RELOAD_MS - 1);
    expect(reloads).toBe(0);
    vi.advanceTimersByTime(1);
    expect(reloads).toBe(1);
    expect(yard.locked).toBe(false);
    yard.destroy();
  });

  it("knows the own-yard load's under-attack refusal", () => {
    const refused = new ApiError("This base is currently under attack by another player.", {
      status: 200,
      serverStatus: 409,
    });
    expect(isUnderAttackRefusal(refused)).toBe(true);
    expect(isUnderAttackRefusal(new ApiError("boom", { status: 500 }))).toBe(false);
    expect(isUnderAttackRefusal(new Error("boom"))).toBe(false);
  });
});

describe("YardAttackWatch", () => {
  it("asks every 10 seconds while an attack runs, and stops after", () => {
    watch.hear({ now: NOW_S, attack: { by: "Raider", ends: NOW_S + 400 } });
    vi.advanceTimersByTime(30_000);
    expect(checks).toBe(3);
    watch.hear({ now: NOW_S + 30 });
    vi.advanceTimersByTime(30_000);
    expect(checks).toBe(3);
  });

  it("DEV: a simulated attack holds until it is let go", () => {
    const changes: unknown[] = [];
    watch.subscribe((attack) => changes.push(attack));
    watch.simulate({ by: "Practice", ends: NOW_S + 60 });
    watch.hear({ now: NOW_S });
    expect(watch.current?.by).toBe("Practice");
    watch.simulate(null);
    expect(watch.current).toBeNull();
    watch.simulate();
    watch.hear({ now: NOW_S, attack: { by: "Raider", ends: NOW_S + 400 } });
    expect(changes).toEqual([{ by: "Practice", ends: NOW_S + 60 }, null, { by: "Raider", ends: NOW_S + 400 }]);
    watch.simulate(null);
  });
});

describe("UnderAttackLock", () => {
  it("names the attacker, counts the attack down, and covers the yard", () => {
    const host = document.createElement("div");
    let now = NOW_S;
    const lock = new UnderAttackLock({ serverNow: () => now, onMap: () => {} });
    lock.show(host, "Raider", NOW_S + 125);
    expect(lock.shown).toBe(true);
    expect(host.querySelector("h2")?.textContent).toBe("Your yard is under attack by Raider!");
    expect(host.textContent).toContain("It ends within 2:05.");
    expect(host.textContent).toContain("paused until the attack ends");
    expect(host.querySelector("button")?.textContent).toBe("Open the map");
    now = NOW_S + 200;
    vi.advanceTimersByTime(500);
    expect(host.textContent).toContain("It is ending now.");
    lock.hide();
    expect(lock.shown).toBe(false);
  });

  it("says so without a name while the server has not said who", () => {
    expect(underAttackTitle(null)).toBe("Your yard is under attack!");
    expect(underAttackCountdown(null)).toBe("Checking when it ends…");
  });
});
