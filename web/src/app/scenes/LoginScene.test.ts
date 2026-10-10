// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { SceneContext } from "../SceneManager";

/**
 * The login screen's sign-up form (issue #213), driven through its DOM with
 * the auth calls stubbed, so no account is made.
 */

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  fetchSignUpOptions: vi.fn(),
}));

vi.mock("@/api/auth", () => auth);
vi.mock("../App", () => ({ SceneName: { YARD: "yard" } }));

const { LoginScene } = await import("./LoginScene");

let root: HTMLElement;
let goTo: ReturnType<typeof vi.fn>;

const open = (turnstileSiteKey = ""): InstanceType<typeof LoginScene> => {
  const scene = new LoginScene(turnstileSiteKey);
  scene.enter({ overlay: { content: root }, goTo } as unknown as SceneContext);
  return scene;
};

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};

const button = (words: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent === words);
  if (!found) throw new Error(`no button "${words}"`);
  return found;
};

const type = (selector: string, value: string): void => {
  const input = $<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event("input"));
};

const leave = (selector: string): void => {
  $<HTMLInputElement>(selector).dispatchEvent(new Event("blur"));
};

const submit = (): void => {
  $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const fillValid = (): void => {
  type("#signup-username", " zz_signup ");
  type("#signup-email", "ZZ@Example.com");
  type("#signup-password", "hunter22!");
  type("#signup-confirm", "hunter22!");
};

const hint = (id: string): HTMLElement => $(`#${id}-hint`);

/** A stand-in for Cloudflare's `window.turnstile`, so no script is fetched. */
const turnstile = {
  render: vi.fn(),
  reset: vi.fn(),
  remove: vi.fn(),
  /** The callback the form handed the widget, to play Cloudflare's part. */
  solve: (token: string) => {
    const options = turnstile.render.mock.calls.at(-1)?.[1] as { callback: (t: string) => void };
    options.callback(token);
  },
};

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete (globalThis as { turnstile?: unknown }).turnstile;
  turnstile.render.mockReset().mockReturnValue("widget-1");
  turnstile.reset.mockReset();
  turnstile.remove.mockReset();
  root = document.createElement("div");
  document.body.append(root);
  goTo = vi.fn();
  auth.login.mockReset().mockResolvedValue({});
  auth.register.mockReset().mockResolvedValue({ user: { userid: 1 } });
  auth.fetchSignUpOptions.mockReset().mockResolvedValue({ sandboxStart: false });
});

describe("LoginScene sign-up", () => {
  it("opens on sign-in, offers Create account, and carries the email across", () => {
    open();
    expect($("h2").textContent).toBe("Sign in");
    type("#email", "zz@example.com");
    button("Create account").click();

    expect($("h2").textContent).toBe("Create account");
    expect($<HTMLInputElement>("#signup-email").value).toBe("zz@example.com");
    expect(document.activeElement).toBe($("#signup-username"));
  });

  it("gives every field the autocomplete a password manager expects", () => {
    open();
    button("Create account").click();
    expect($<HTMLInputElement>("#signup-username").autocomplete).toBe("nickname");
    expect($<HTMLInputElement>("#signup-email").autocomplete).toBe("username");
    expect($<HTMLInputElement>("#signup-password").autocomplete).toBe("new-password");
    expect($<HTMLInputElement>("#signup-confirm").autocomplete).toBe("new-password");
  });

  it("keeps the fields, then the submit button, then the way back, in tab order", () => {
    open();
    button("Create account").click();
    const order = [...root.querySelectorAll("input, button")]
      .filter((element) => !element.closest(".panel__titlebar, [hidden]"))
      .map((element) => element.id || element.textContent);
    expect(order).toEqual([
      "signup-username",
      "signup-email",
      "signup-password",
      "signup-confirm",
      "Create account",
      "I already have an account",
    ]);
  });

  it("shows a definite mistake as it is typed, and a short one only after leaving the field", () => {
    open();
    button("Create account").click();

    type("#signup-username", "a");
    expect(hint("signup-username").classList.contains("field__hint--error")).toBe(false);
    leave("#signup-username");
    expect(hint("signup-username").classList.contains("field__hint--error")).toBe(true);

    type("#signup-username", "a b");
    expect(hint("signup-username").textContent).toMatch(/letters, numbers and underscores/);
    expect($("#signup-username").getAttribute("aria-invalid")).toBe("true");

    type("#signup-username", "zz_signup");
    expect(hint("signup-username").classList.contains("field__hint--ok")).toBe(true);
  });

  it("refuses to send a form with a problem and focuses the first one", async () => {
    open();
    button("Create account").click();
    type("#signup-username", "zz_signup");
    type("#signup-email", "nope");
    submit();
    await settle();

    expect(auth.register).not.toHaveBeenCalled();
    expect(document.activeElement).toBe($("#signup-email"));
    expect(hint("signup-password").classList.contains("field__hint--error")).toBe(true);
  });

  it("creates the account, signs in with it and goes to the yard", async () => {
    open();
    button("Create account").click();
    fillValid();
    submit();
    await settle();

    expect(auth.register).toHaveBeenCalledWith({
      username: "zz_signup",
      email: "zz@example.com",
      password: "hunter22!",
      termsAccepted: true,
    });
    expect(auth.login).toHaveBeenCalledWith("zz@example.com", "hunter22!");
    expect(goTo).toHaveBeenCalledWith("yard");
  });

  it("puts a taken name on the username field until it is edited", async () => {
    auth.register.mockRejectedValue(
      new ApiError("An account with this username already exists.", {
        status: 409,
        details: { status: 409, data: { reason: "usernameTaken" } },
      }),
    );
    open();
    button("Create account").click();
    fillValid();
    submit();
    await settle();

    expect(hint("signup-username").textContent).toBe(
      "That username is taken. Try another one.",
    );
    expect(document.activeElement).toBe($("#signup-username"));
    expect(auth.login).not.toHaveBeenCalled();
    expect(button("Create account").disabled).toBe(false);

    type("#signup-username", "zz_signup2");
    expect(hint("signup-username").classList.contains("field__hint--error")).toBe(false);
  });

  it("shows a rate limit above the button", async () => {
    auth.register.mockRejectedValue(
      new ApiError("Too many", { status: 429, code: "Too many" }),
    );
    open();
    button("Create account").click();
    fillValid();
    submit();
    await settle();

    expect($(".form-error").textContent).toMatch(/too many accounts/i);
  });

  it("sends a player whose sign-in fails after sign-up to the sign-in form, email filled", async () => {
    auth.login.mockRejectedValue(new ApiError("Verify your Discord account.", { status: 403 }));
    open();
    button("Create account").click();
    fillValid();
    submit();
    await settle();

    expect($("h2").textContent).toBe("Sign in");
    expect($<HTMLInputElement>("#email").value).toBe("zz@example.com");
    expect($(".form-error").textContent).toContain("Your account is ready");
    expect(goTo).not.toHaveBeenCalled();
  });

  it("goes back to sign-in from I already have an account", () => {
    open();
    button("Create account").click();
    type("#signup-email", "zz@example.com");
    button("I already have an account").click();
    expect($("h2").textContent).toBe("Sign in");
    expect($<HTMLInputElement>("#email").value).toBe("zz@example.com");
    expect(document.activeElement).toBe($("#password"));
  });
});

describe("LoginScene sign-up launch extras", () => {
  it("says under the button what creating an account agrees to, with both links", () => {
    open();
    button("Create account").click();

    const terms = $(".login-form__terms");
    expect(terms.textContent).toBe(
      "By creating an account you agree to the Terms and Privacy Policy and confirm you are 16 or older.",
    );
    expect(terms.previousElementSibling).toBe(button("Create account"));
    const links = [...terms.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
    expect(links.every((link) => link.target === "_blank" && link.rel === "noopener")).toBe(true);
  });

  it("flags a reserved name as it is typed", () => {
    open();
    button("Create account").click();
    type("#signup-username", "Admin");
    expect(hint("signup-username").textContent).toBe(
      "That name belongs to the game's own team. Please pick another one.",
    );
  });

  it("shows no bot check and loads no script without a site key", async () => {
    open();
    button("Create account").click();
    fillValid();
    submit();
    await settle();

    expect(root.querySelector(".bot-check")).toBeNull();
    expect(document.head.querySelector("script")).toBeNull();
    expect(auth.register.mock.calls[0]?.[0]).not.toHaveProperty("turnstileToken");
  });

  it("draws the bot check only on the sign-up form, and removes it on the way back", async () => {
    (globalThis as { turnstile?: unknown }).turnstile = turnstile;
    open("1x00000000000000000000AA");
    await settle();
    expect(turnstile.render).not.toHaveBeenCalled();

    button("Create account").click();
    await settle();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(turnstile.render.mock.calls[0]?.[0]).toBe($(".bot-check"));
    expect(turnstile.render.mock.calls[0]?.[1]).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "signup",
    });

    button("I already have an account").click();
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("waits for the bot check, then sends its token", async () => {
    (globalThis as { turnstile?: unknown }).turnstile = turnstile;
    open("1x00000000000000000000AA");
    button("Create account").click();
    await settle();
    fillValid();

    submit();
    await settle();
    expect(auth.register).not.toHaveBeenCalled();
    expect($(".form-error").textContent).toBe(
      "Please wait for the check above to finish, then try again.",
    );

    turnstile.solve("XXXX.DUMMY.TOKEN.XXXX");
    submit();
    await settle();
    expect(auth.register.mock.calls[0]?.[0]).toMatchObject({
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      termsAccepted: true,
    });
  });

  it("runs the bot check again after a refusal, since the token is spent", async () => {
    auth.register.mockRejectedValue(
      new ApiError("We couldn't confirm you're a person.", {
        status: 400,
        details: { status: 400, data: { reason: "botCheckFailed" } },
      }),
    );
    (globalThis as { turnstile?: unknown }).turnstile = turnstile;
    open("1x00000000000000000000AA");
    button("Create account").click();
    await settle();
    fillValid();
    turnstile.solve("XXXX.DUMMY.TOKEN.XXXX");
    submit();
    await settle();

    expect($(".form-error").textContent).toBe("We couldn't confirm you're a person.");
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");

    submit();
    await settle();
    expect(auth.register).toHaveBeenCalledTimes(1);
  });
});

describe("LoginScene sign-up — the dev-only test yard box (#217)", () => {
  const box = (): HTMLInputElement => $<HTMLInputElement>("#signup-sandbox-start");
  const row = (): HTMLElement => box().closest("label")!;

  it("is not shown when the server does not offer the test yard", async () => {
    open();
    button("Create account").click();
    await settle();

    expect(auth.fetchSignUpOptions).toHaveBeenCalled();
    expect(row().hidden).toBe(true);
  });

  it("is shown, unticked, after the confirm field when the server offers it", async () => {
    auth.fetchSignUpOptions.mockResolvedValue({ sandboxStart: true });
    open();
    button("Create account").click();
    await settle();

    expect(row().hidden).toBe(false);
    expect(row().textContent).toBe("Start with the test yard (dev)");
    expect(box().checked).toBe(false);
    const order = [...root.querySelectorAll("input, button")]
      .filter((element) => !element.closest(".panel__titlebar, [hidden]"))
      .map((element) => element.id || element.textContent);
    expect(order.slice(3, 5)).toEqual(["signup-confirm", "signup-sandbox-start"]);
  });

  it("left unticked, the sign-up does not ask for the test yard", async () => {
    auth.fetchSignUpOptions.mockResolvedValue({ sandboxStart: true });
    open();
    button("Create account").click();
    await settle();
    fillValid();
    submit();
    await settle();

    expect(auth.register).toHaveBeenCalledWith(
      expect.not.objectContaining({ sandboxStart: expect.anything() }),
    );
  });

  it("ticked, the sign-up asks for the test yard", async () => {
    auth.fetchSignUpOptions.mockResolvedValue({ sandboxStart: true });
    open();
    button("Create account").click();
    await settle();
    fillValid();
    box().click();
    submit();
    await settle();

    expect(auth.register).toHaveBeenCalledWith({
      username: "zz_signup",
      email: "zz@example.com",
      password: "hunter22!",
      termsAccepted: true,
      sandboxStart: true,
    });
  });
});

describe("LoginScene sign-out", () => {
  it("forgets the last account's Baiter tests and unlock queue", async () => {
    const { clearTestHistory, recentTests, recordTest } = await import("@/game/baiter/testHistory");
    const { unlockInbox } = await import("@/game/achievements/unlockInbox");
    recordTest({
      run: { save: {}, army: {}, baiterLevel: 1 },
      seed: 7,
      events: [],
      endTick: 400,
      report: {},
    } as unknown as Parameters<typeof recordTest>[0]);
    unlockInbox.add([{ id: 3, name: "Seen it", shiny: 5 }]);
    expect(recentTests()).toHaveLength(1);
    expect(unlockInbox.size).toBe(1);

    open();

    expect(recentTests()).toEqual([]);
    expect(unlockInbox.size).toBe(0);
    // The next account's unlock with the same id still pops up.
    expect(unlockInbox.add([{ id: 3, name: "Seen it", shiny: 5 }])).toBe(true);
    unlockInbox.reset();
    clearTestHistory();
  });
});
