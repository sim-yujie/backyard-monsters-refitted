/**
 * Cloudflare Turnstile, the sign-up form's bot check (issue #213).
 *
 * The widget's script is loaded only when the sign-up form opens, never on
 * the sign-in form or in the game, and only when the build has a site key
 * (`TURNSTILE_SITE_KEY`, see `.env.example`). The widget hands the form a
 * one-use token, which the register route checks with Cloudflare before it
 * creates the account (`server/src/services/auth/turnstile.ts`). A token is
 * spent by that check, so the form asks for a fresh one after any refusal.
 */

export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The part of Cloudflare's `window.turnstile` this client uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

const loadedApi = (): TurnstileApi | undefined =>
  (globalThis as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once and resolves with its API. */
export const loadTurnstile = (): Promise<TurnstileApi> => {
  const ready = loadedApi();
  if (ready) return Promise.resolve(ready);

  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;

    // A failed load may be a blip: forget it, so the next form tries again.
    const fail = (): void => {
      loading = null;
      script.remove();
      reject(new Error("The Turnstile script did not load."));
    };

    script.addEventListener("load", () => {
      const api = loadedApi();
      if (api) resolve(api);
      else fail();
    });
    script.addEventListener("error", fail);
    document.head.append(script);
  });
  return loading;
};

export const BOT_CHECK_UNLOADED =
  "The check that you're a person didn't load. Check your connection, then reopen this form.";

/**
 * One Turnstile widget on a form: where it sits, and the token it last gave.
 */
export class BotCheck {
  readonly element: HTMLElement;
  private readonly status: HTMLElement;
  private api: TurnstileApi | null = null;
  private widgetId: string | null = null;
  private currentToken: string | null = null;
  private destroyed = false;

  constructor(private readonly siteKey: string) {
    this.element = document.createElement("div");
    this.element.className = "bot-check";

    this.status = document.createElement("p");
    this.status.className = "bot-check__status";
    this.status.setAttribute("role", "status");
    this.element.append(this.status);
  }

  /** The token to send, or null while the check is unfinished, expired or spent. */
  get token(): string | null {
    return this.currentToken;
  }

  /** Loads the script if needed and draws the widget. */
  async mount(): Promise<void> {
    try {
      const api = await loadTurnstile();
      if (this.destroyed) return;
      this.api = api;
      this.widgetId =
        api.render(this.element, {
          sitekey: this.siteKey,
          action: "signup",
          theme: "dark",
          callback: (token) => {
            this.currentToken = token;
          },
          "expired-callback": () => {
            this.currentToken = null;
          },
          "error-callback": () => {
            this.currentToken = null;
          },
        }) ?? null;
    } catch {
      if (!this.destroyed) this.status.textContent = BOT_CHECK_UNLOADED;
    }
  }

  /** Throws the current token away and runs the check again, for the next try. */
  reset(): void {
    this.currentToken = null;
    if (this.api && this.widgetId !== null) this.api.reset(this.widgetId);
  }

  destroy(): void {
    this.destroyed = true;
    this.currentToken = null;
    if (this.api && this.widgetId !== null) this.api.remove(this.widgetId);
    this.api = null;
    this.widgetId = null;
  }
}
