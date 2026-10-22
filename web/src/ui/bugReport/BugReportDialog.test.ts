// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BugReportResult } from "@/api/bugReport";
import type { ReportContext } from "@/game/bugReport/reportContext";
import { PictureError } from "@/game/bugReport/screenCapture";
import { THANK_YOU, openBugReport, type BugReportOptions } from "./BugReportDialog";

/**
 * The "Report a bug" form, driven through its DOM with the screenshot, the
 * picture reader and the send stubbed: what goes in the report, the
 * screenshot taken out and put back, the checks before sending, the thank
 * you, the daily cap, and the signed-out form's email and Turnstile check.
 */

const SHOT = "data:image/jpeg;base64,c2hvdA==";
const PICTURE = "data:image/jpeg;base64,cGljdHVyZQ==";

const CONTEXT: ReportContext = {
  gameVersion: "2.0.0-beta.4",
  screen: "yard",
  device: "phone",
  userAgent: "test-agent",
  screenSize: "390x844 window at 3x",
  errors: ["08:00:00 error: boom"],
};

let container: HTMLElement;
let send: ReturnType<typeof vi.fn>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = async (extra: Partial<BugReportOptions> = {}) => {
  const popup = openBugReport({
    container,
    signedIn: true,
    capture: async () => SHOT,
    context: () => CONTEXT,
    send: send as unknown as NonNullable<BugReportOptions["send"]>,
    picture: async () => PICTURE,
    ...extra,
  });
  await flush();
  return popup;
};

const $ = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector);
const type = (selector: string, value: string) => {
  const field = $<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input"));
};
const submit = async () => {
  $<HTMLFormElement>(".bug-report")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
};
const buttonCalled = (words: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent === words);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  send = vi.fn(async (): Promise<BugReportResult> => ({ ok: true, id: 7 }));
});

afterEach(() => {
  container.remove();
  delete (globalThis as { turnstile?: unknown }).turnstile;
});

describe("signed in (the Account menu)", () => {
  it("takes the screenshot before the form is drawn", async () => {
    const capture = vi.fn(async () => {
      expect(container.querySelector(".bug-report-popup")).toBeNull();
      return SHOT;
    });
    await open({ capture });
    expect(capture).toHaveBeenCalledOnce();
    expect($(".bug-report-popup")).not.toBeNull();
  });

  it("asks for no email, shows the screenshot, and sends the words with everything gathered", async () => {
    await open();
    expect($("input[type=email]")).toBeNull();
    expect($<HTMLImageElement>(".bug-report__screenshot img")!.src).toBe(SHOT);
    expect($(".bug-report__also")!.textContent).toContain("player name, game version, which screen you were on");

    type("textarea", "  The hatchery button does nothing  ");
    expect($(".bug-report__counter")!.textContent).toBe("36 / 2000");
    await submit();

    expect(send).toHaveBeenCalledOnce();
    const [payload, signedIn] = send.mock.calls[0]!;
    expect(signedIn).toBe(true);
    expect(payload).toEqual({ ...CONTEXT, message: "The hatchery button does nothing", screenshot: SHOT });
  });

  it("lets the player take the screenshot out and put it back", async () => {
    await open();
    buttonCalled("Remove")!.click();
    expect($(".bug-report__screenshot img")).toBeNull();
    expect($(".bug-report__screenshot")!.textContent).toContain("no screenshot will be sent");

    buttonCalled("Put it back")!.click();
    expect($(".bug-report__screenshot img")).not.toBeNull();

    buttonCalled("Remove")!.click();
    type("textarea", "Map will not open");
    await submit();
    expect(send.mock.calls[0]![0]).not.toHaveProperty("screenshot");
  });

  it("says so when no screenshot could be taken", async () => {
    await open({ capture: async () => null });
    expect($(".bug-report__screenshot")!.textContent).toContain("couldn't take a picture");
    type("textarea", "Map will not open");
    await submit();
    expect(send.mock.calls[0]![0]).not.toHaveProperty("screenshot");
  });

  it("adds the player's own picture, and can drop it again", async () => {
    await open();
    const input = $<HTMLInputElement>(".bug-report__file")!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "photo.png", { type: "image/png" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect($<HTMLImageElement>(".bug-report__picture img")!.src).toBe(PICTURE);

    container.querySelectorAll<HTMLButtonElement>(".bug-report__picture button")[1]!.click();
    expect($(".bug-report__picture img")).toBeNull();

    input.dispatchEvent(new Event("change"));
    await flush();
    type("textarea", "Look at this");
    await submit();
    expect(send.mock.calls[0]![0]).toMatchObject({ picture: PICTURE });
  });

  it("shows why a picture was not taken", async () => {
    await open({
      picture: async () => {
        throw new PictureError("Please pick a picture (JPEG, PNG or WebP).");
      },
    });
    const input = $<HTMLInputElement>(".bug-report__file")!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "notes.txt", { type: "text/plain" })], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect($(".bug-report__picture-error")!.textContent).toBe("Please pick a picture (JPEG, PNG or WebP).");
    expect($(".bug-report__picture img")).toBeNull();
  });

  it("needs a few words first", async () => {
    await open();
    type("textarea", " a ");
    await submit();
    expect(send).not.toHaveBeenCalled();
    expect($(".bug-report__error")!.textContent).toBe("Please tell us a little about what went wrong.");
  });

  it("says thank you once it is sent", async () => {
    await open();
    type("textarea", "Map will not open");
    await submit();
    expect($(".bug-report--done")!.textContent).toContain(THANK_YOU);
    expect($(".bug-report textarea")).toBeNull();
    buttonCalled("Back to the game")!.click();
    expect($(".bug-report-popup")).toBeNull();
  });

  it("shows the friendly limit message and stops further sends", async () => {
    send.mockResolvedValueOnce({
      ok: false,
      message: "Thanks for all your reports! You can send 5 a day, so please try again tomorrow.",
      limit: true,
      botCheck: false,
    });
    await open();
    type("textarea", "Map will not open");
    await submit();
    expect($(".bug-report__error")!.textContent).toContain("try again tomorrow");
    expect($<HTMLButtonElement>(".bug-report button[type=submit]")!.disabled).toBe(true);
  });

  it("keeps the words after a failed send so the player can try again", async () => {
    send.mockResolvedValueOnce({ ok: false, message: "Couldn't reach the game server.", limit: false, botCheck: false });
    await open();
    type("textarea", "Map will not open");
    await submit();
    expect($(".bug-report__error")!.textContent).toBe("Couldn't reach the game server.");
    expect($<HTMLTextAreaElement>("textarea")!.value).toBe("Map will not open");
    expect($<HTMLButtonElement>(".bug-report button[type=submit]")!.disabled).toBe(false);
  });
});

describe("signed out (the login screen)", () => {
  it("needs an email for the reply and sends it along", async () => {
    await open({ signedIn: false });
    expect($(".bug-report__also")!.textContent).not.toContain("player name");
    type("textarea", "Cannot sign in");
    await submit();
    expect(send).not.toHaveBeenCalled();
    expect($(".bug-report__error")!.textContent).toBe("Please enter your email address, so we can reply.");

    type("input[type=email]", " someone@example.com ");
    await submit();
    const [payload, signedIn] = send.mock.calls[0]!;
    expect(signedIn).toBe(false);
    expect(payload).toMatchObject({ email: "someone@example.com", message: "Cannot sign in" });
    expect(payload).not.toHaveProperty("turnstileToken");
  });

  it("runs the Turnstile check when the build has a site key, and asks for a fresh token after a refusal", async () => {
    const reset = vi.fn();
    let pass: ((token: string) => void) | undefined;
    (globalThis as { turnstile?: unknown }).turnstile = {
      render: (_: HTMLElement, options: { callback: (token: string) => void; action: string }) => {
        expect(options.action).toBe("bug_report");
        pass = options.callback;
        return "widget-1";
      },
      reset,
      remove: vi.fn(),
    };
    await open({ signedIn: false, turnstileSiteKey: "site-key" });
    type("input[type=email]", "someone@example.com");
    type("textarea", "Cannot sign in");
    await submit();
    expect(send).not.toHaveBeenCalled();
    expect($(".bug-report__error")!.textContent).toBe("Please finish the check that you're a person first.");

    pass!("token-1");
    send.mockResolvedValueOnce({ ok: false, message: "We couldn't confirm you're a person.", limit: false, botCheck: true });
    await submit();
    expect(send.mock.calls[0]![0]).toMatchObject({ turnstileToken: "token-1" });
    expect(reset).toHaveBeenCalledWith("widget-1");
  });
});
