/**
 * Learns when a new game page has gone live, so a tab left open across a
 * release does not keep running the old code (bug report 4, 2 Nov 2026: a
 * tab still showing the look from before v2.0.0-beta.5.3, two days after it).
 *
 * Every build names its entry script after its own contents
 * (`/static/index-<hash>.js`), and `index.html` is served with `max-age=0,
 * must-revalidate` (`vercel.json`). So the page fetches `/` now and then and
 * compares the script it names with the one this tab is running: a different
 * name is a different build. Nothing on the server has to change, and a
 * check costs one small request for a page of about 1 KB.
 *
 * The game version (`LATEST_RELEASE`) cannot do this: it changes only on big
 * releases, so it cannot tell 5.2 from 5.3.
 */

/** The entry script a page's HTML names, as "/static/index-<hash>.js", or null. */
export const bundleNameIn = (html: string): string | null =>
  html.match(/\/static\/index-[\w-]+\.js/)?.[0] ?? null;

/**
 * The entry script this tab is running, or null in a dev build, which serves
 * `/src/main.ts` and has nothing to compare.
 */
export const runningBundleName = (doc: Document = document): string | null => {
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script[type=module][src]")) {
    const name = bundleNameIn(script.getAttribute("src") ?? "");
    if (name) return name;
  }
  return null;
};

/** Every 5 minutes while the tab is open, and on coming back to it if a minute has passed. */
export const UPDATE_CHECK_TIMINGS = { everyMs: 5 * 60_000, minGapMs: 60_000 } as const;

export interface UpdateCheckOptions {
  /** The entry script this tab is running ({@link runningBundleName}). */
  readonly running: string;
  /** The live page's HTML; a failure is skipped and tried again next time. */
  readonly fetchPage: () => Promise<string>;
  /** Called once, with the new script's name, when the live page names another. */
  readonly onNewVersion: (bundle: string) => void;
  readonly timings?: { readonly everyMs: number; readonly minGapMs: number };
  readonly now?: () => number;
  /** Where "came back to the tab" and "back online" are heard; the page's window by default. */
  readonly target?: { readonly doc: Document; readonly win: Window };
}

/**
 * Checks the live page on a timer, when the tab is shown again (a hidden
 * tab's timers are slowed, so coming back is when an old tab most needs it)
 * and when the network comes back. Stops for good once it finds a new build:
 * the prompt then stays until the player reloads.
 */
export class UpdateCheck {
  private readonly everyMs: number;
  private readonly minGapMs: number;
  private readonly now: () => number;
  private readonly doc: Document;
  private readonly win: Window;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCheck = -Infinity;
  private checking = false;
  private found = false;

  constructor(private readonly options: UpdateCheckOptions) {
    this.everyMs = options.timings?.everyMs ?? UPDATE_CHECK_TIMINGS.everyMs;
    this.minGapMs = options.timings?.minGapMs ?? UPDATE_CHECK_TIMINGS.minGapMs;
    this.now = options.now ?? Date.now;
    this.doc = options.target?.doc ?? document;
    this.win = options.target?.win ?? window;
  }

  start(): void {
    if (this.timer !== null || this.found) return;
    // The page was just fetched to start this tab: the first check waits a full turn.
    this.lastCheck = this.now();
    this.timer = setInterval(() => void this.check(), this.everyMs);
    this.doc.addEventListener("visibilitychange", this.onShown);
    this.win.addEventListener("online", this.onShown);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.doc.removeEventListener("visibilitychange", this.onShown);
    this.win.removeEventListener("online", this.onShown);
  }

  /** Fetches the live page once and compares; true when it names another build. */
  async check(): Promise<boolean> {
    if (this.found || this.checking) return this.found;
    this.checking = true;
    this.lastCheck = this.now();
    try {
      const live = bundleNameIn(await this.options.fetchPage());
      // No name (an error page, a captive portal's login page) says nothing.
      if (live && live !== this.options.running) {
        this.found = true;
        this.stop();
        this.options.onNewVersion(live);
      }
    } catch {
      // Offline or the server is busy: the next turn tries again.
    } finally {
      this.checking = false;
    }
    return this.found;
  }

  private readonly onShown = (): void => {
    if (this.doc.visibilityState !== "visible") return;
    if (this.now() - this.lastCheck < this.minGapMs) return;
    void this.check();
  };
}

/** The live game page's HTML, past every cache. */
export const fetchLivePage = async (): Promise<string> => {
  const response = await fetch(import.meta.env.BASE_URL, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Page check failed: ${response.status}`);
  return response.text();
};
