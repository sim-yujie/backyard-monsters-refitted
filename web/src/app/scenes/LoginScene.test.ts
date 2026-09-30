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
}));

vi.mock("@/api/auth", () => auth);
vi.mock("../App", () => ({ SceneName: { YARD: "yard" } }));

const { LoginScene } = await import("./LoginScene");

let root: HTMLElement;
let goTo: ReturnType<typeof vi.fn>;

const open = (): InstanceType<typeof LoginScene> => {
  const scene = new LoginScene();
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

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
  goTo = vi.fn();
  auth.login.mockReset().mockResolvedValue({});
  auth.register.mockReset().mockResolvedValue({ user: { userid: 1 } });
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
      .filter((element) => !element.closest(".panel__titlebar"))
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
