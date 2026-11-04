// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateCheck, bundleNameIn, runningBundleName } from "./updateCheck";

/** "New version": comparing this tab's build with the live page's. */

const page = (bundle: string): string =>
  `<!doctype html><html><head><script type="module" crossorigin src="${bundle}"></script>` +
  `<link rel="stylesheet" crossorigin href="/static/index-Bq3x.css"></head><body></body></html>`;

const OLD = "/static/index-C4a_9xZ-.js";
const NEW = "/static/index-Dk2pQ7wE.js";

/** Lets the check's fetch and its comparison run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const setVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
  document.head.replaceChildren();
});

describe("bundleNameIn", () => {
  it("finds the entry script a built page names", () => {
    expect(bundleNameIn(page(OLD))).toBe(OLD);
    expect(bundleNameIn(`https://bymrevamped.com${NEW}`)).toBe(NEW);
  });

  it("says nothing for a page without one", () => {
    expect(bundleNameIn(page("/src/main.ts"))).toBeNull();
    expect(bundleNameIn("<html><body>Sign in to the Wi-Fi</body></html>")).toBeNull();
    expect(bundleNameIn("")).toBeNull();
  });
});

describe("runningBundleName", () => {
  it("reads this tab's own entry script", () => {
    document.head.innerHTML = `<script type="module" crossorigin src="${OLD}"></script>`;
    expect(runningBundleName()).toBe(OLD);
  });

  it("is null in a dev build, which runs /src/main.ts", () => {
    document.head.innerHTML = `<script type="module" src="/src/main.ts"></script>`;
    expect(runningBundleName()).toBeNull();
  });
});

describe("UpdateCheck", () => {
  it("stays quiet while the live page names the same build", async () => {
    const onNewVersion = vi.fn();
    const fetchPage = vi.fn(async () => page(OLD));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion });
    check.start();
    expect(fetchPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(onNewVersion).not.toHaveBeenCalled();
    check.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tells once, and stops checking, when a new build goes live", async () => {
    const onNewVersion = vi.fn();
    let live = OLD;
    const fetchPage = vi.fn(async () => page(live));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion });
    check.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onNewVersion).not.toHaveBeenCalled();
    live = NEW;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith(NEW);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("skips a failed fetch or a page without a script, and tries again next time", async () => {
    const onNewVersion = vi.fn();
    const fetchPage = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("<html>Sign in to the Wi-Fi</html>")
      .mockResolvedValue(page(NEW));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion });
    check.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onNewVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith(NEW);
  });

  it("checks when the player comes back to the tab, at most once a minute", async () => {
    const onNewVersion = vi.fn();
    const fetchPage = vi.fn(async () => page(OLD));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion });
    check.start();

    // Just loaded: coming straight back does not fetch again.
    setVisibility("hidden");
    setVisibility("visible");
    expect(fetchPage).not.toHaveBeenCalled();

    // Hidden for two minutes (a hidden tab's timers may not have fired).
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(fetchPage).not.toHaveBeenCalled();
    setVisibility("visible");
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);

    // Back again 30 seconds later: too soon.
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + 30_000);
    setVisibility("visible");
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    check.stop();
  });

  it("checks when the network comes back", async () => {
    const onNewVersion = vi.fn();
    const fetchPage = vi.fn(async () => page(NEW));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion });
    check.start();
    vi.setSystemTime(Date.now() + 2 * 60_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith(NEW);
  });

  it("hears nothing after it is stopped", async () => {
    const fetchPage = vi.fn(async () => page(NEW));
    const check = new UpdateCheck({ running: OLD, fetchPage, onNewVersion: vi.fn() });
    check.start();
    check.stop();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    setVisibility("visible");
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
