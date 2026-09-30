import { login, register } from "@/api/auth";
import { ApiError, NetworkError } from "@/api/http";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";
import {
  SIGN_UP_FIELDS,
  SIGN_UP_HINTS,
  describeSignUpFailure,
  isDefiniteProblem,
  signUpProblems,
  signUpRequest,
  type SignUpField,
  type SignUpValues,
} from "./signUp";

interface FieldOptions {
  id: string;
  label: string;
  type: string;
  /** "nickname" is a standard autofill token that TypeScript's AutoFill type leaves out. */
  autocomplete: AutoFill | "nickname";
  /** The form field's name, when it should differ from the id. */
  name?: string;
  /** A line under the input, tied to it with aria-describedby. */
  hint?: string;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  hint: HTMLElement | null;
}

/** Builds a labelled input row. */
const field = (options: FieldOptions): Field => {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const labelElement = document.createElement("label");
  labelElement.className = "field__label";
  labelElement.htmlFor = options.id;
  labelElement.textContent = options.label;

  const input = document.createElement("input");
  input.className = "field__input";
  input.id = options.id;
  input.name = options.name ?? options.id;
  input.type = options.type;
  input.setAttribute("autocomplete", options.autocomplete);
  input.required = true;

  wrapper.append(labelElement, input);

  let hint: HTMLElement | null = null;
  if (options.hint !== undefined) {
    hint = document.createElement("p");
    hint.className = "field__hint";
    hint.id = `${options.id}-hint`;
    hint.setAttribute("aria-live", "polite");
    hint.textContent = options.hint;
    input.setAttribute("aria-describedby", hint.id);
    wrapper.append(hint);
  }

  return { wrapper, input, hint };
};

/** A name or email field: no capitals, corrections or spell checking forced on it. */
const plainText = (input: HTMLInputElement): void => {
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
};

/** The line under the form that swaps between signing in and signing up. */
const switchRow = (question: string, action: string, onClick: () => void): HTMLElement => {
  const row = document.createElement("p");
  row.className = "login-form__switch";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--outline login-form__switch-button";
  button.textContent = action;
  button.addEventListener("click", onClick);

  if (question) {
    const words = document.createElement("span");
    words.textContent = question;
    row.append(words);
  }
  row.append(button);
  return row;
};

const primaryButton = (label: string): HTMLButtonElement => {
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn--primary";
  submit.textContent = label;
  return submit;
};

/**
 * The sign-in and sign-up forms, rendered as HTML over an empty canvas.
 *
 * Sign-in's password rules mirror the server's schema (at least 8 characters
 * with one non-alphanumeric) so an obvious mistake is caught before a round
 * trip, but the server stays the authority. Sign-up (issue #213) checks every
 * field against the shared account rules as the player types, creates the
 * account, then signs in with it and goes straight to the yard, whose first
 * load builds it.
 */
export class LoginScene implements Scene {
  private panel: Panel | null = null;
  private wrapper: HTMLElement | null = null;

  enter(context: SceneContext): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "scene-centre";

    this.panel = new Panel({ title: "Sign in", closable: false });

    this.wrapper.append(this.panel.element);
    context.overlay.content.append(this.wrapper);

    this.showSignIn(context);
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
    this.wrapper?.remove();
    this.wrapper = null;
  }

  private showSignIn(
    context: SceneContext,
    carried: { email?: string; notice?: string } = {},
  ): void {
    const form = document.createElement("form");
    form.className = "login-form";
    form.noValidate = true;

    const email = field({
      id: "email",
      label: "Email",
      type: "email",
      autocomplete: "username",
    });
    const password = field({
      id: "password",
      label: "Password",
      type: "password",
      autocomplete: "current-password",
    });
    plainText(email.input);
    email.input.value = carried.email ?? "";

    const error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");
    error.textContent = carried.notice ?? "";

    const submit = primaryButton("Play");

    const toSignUp = switchRow("New here?", "Create account", () =>
      this.showSignUp(context, { email: email.input.value }),
    );

    form.append(email.wrapper, password.wrapper, error, submit, toSignUp);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(context, {
        email: email.input.value.trim(),
        password: password.input.value,
        error,
        submit,
      });
    });

    this.panel?.setTitle("Sign in").setContent(form);
    (email.input.value ? password.input : email.input).focus();
  }

  private showSignUp(context: SceneContext, carried: { email?: string } = {}): void {
    const form = document.createElement("form");
    form.className = "login-form";
    form.noValidate = true;

    const fields: Record<SignUpField, Field> = {
      username: field({
        id: "signup-username",
        name: "nickname",
        label: "Username",
        type: "text",
        autocomplete: "nickname",
        hint: SIGN_UP_HINTS.username,
      }),
      // The email is what signs in, so password managers file it as the username.
      email: field({
        id: "signup-email",
        name: "email",
        label: "Email",
        type: "email",
        autocomplete: "username",
        hint: SIGN_UP_HINTS.email,
      }),
      password: field({
        id: "signup-password",
        name: "new-password",
        label: "Password",
        type: "password",
        autocomplete: "new-password",
        hint: SIGN_UP_HINTS.password,
      }),
      confirm: field({
        id: "signup-confirm",
        name: "confirm-password",
        label: "Confirm password",
        type: "password",
        autocomplete: "new-password",
        hint: SIGN_UP_HINTS.confirm,
      }),
    };
    plainText(fields.username.input);
    plainText(fields.email.input);
    fields.email.input.value = carried.email ?? "";

    const error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");

    const submit = primaryButton("Create account");

    const toSignIn = switchRow("", "I already have an account", () =>
      this.showSignIn(context, { email: fields.email.input.value.trim() }),
    );

    form.append(...SIGN_UP_FIELDS.map((name) => fields[name].wrapper), error, submit, toSignIn);

    // A field shows its problem once the player has left it or tried to submit;
    // before that only a problem typing on cannot fix. A refusal from the server
    // stays on its field until that field is edited.
    const touched = new Set<SignUpField>();
    const refused = new Map<SignUpField, string>();

    const values = (): SignUpValues => ({
      username: fields.username.input.value,
      email: fields.email.input.value,
      password: fields.password.input.value,
      confirm: fields.confirm.input.value,
    });

    const render = (): void => {
      const current = values();
      const problems = signUpProblems(current);
      for (const name of SIGN_UP_FIELDS) {
        const { input, hint } = fields[name];
        if (!hint) continue;
        const problem =
          refused.get(name) ??
          (touched.has(name) || isDefiniteProblem(name, current) ? problems[name] : null);
        const ok = problems[name] === null && current[name] !== "" && !refused.has(name);

        hint.textContent = problem ?? SIGN_UP_HINTS[name];
        hint.classList.toggle("field__hint--error", problem !== null);
        hint.classList.toggle("field__hint--ok", problem === null && ok);
        input.setAttribute("aria-invalid", String(problem !== null));
      }
    };

    for (const name of SIGN_UP_FIELDS) {
      const { input } = fields[name];
      input.addEventListener("input", () => {
        refused.delete(name);
        render();
      });
      input.addEventListener("blur", () => {
        if (input.value !== "") touched.add(name);
        render();
      });
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "";

      const problems = signUpProblems(values());
      const firstProblem = SIGN_UP_FIELDS.find((name) => problems[name] !== null);
      if (firstProblem) {
        for (const name of SIGN_UP_FIELDS) touched.add(name);
        render();
        fields[firstProblem].input.focus();
        return;
      }

      void this.createAccount(context, {
        values: values(),
        error,
        submit,
        onRefused: (name, message) => {
          refused.set(name, message);
          render();
          fields[name].input.focus();
        },
      });
    });

    this.panel?.setTitle("Create account").setContent(form);
    fields.username.input.focus();
    render();
  }

  private async submit(
    context: SceneContext,
    form: {
      email: string;
      password: string;
      error: HTMLElement;
      submit: HTMLButtonElement;
    },
  ): Promise<void> {
    form.error.textContent = "";

    if (!form.email) {
      form.error.textContent = "Enter your email address.";
      return;
    }
    if (form.password.length < 8 || !/[^a-zA-Z0-9]/.test(form.password)) {
      form.error.textContent =
        "Passwords are at least 8 characters and contain one special character.";
      return;
    }

    form.submit.disabled = true;
    form.submit.textContent = "Signing in…";

    try {
      await login(form.email, form.password);
      // The yard first, for every player (issue #172); the map is one click on.
      context.goTo(SceneName.YARD);
    } catch (caught) {
      form.error.textContent = describe(caught);
      form.submit.disabled = false;
      form.submit.textContent = "Play";
    }
  }

  /**
   * Registers, then signs in with the same email and password. The yard's
   * first load builds the new player's base, so the yard is the next stop.
   */
  private async createAccount(
    context: SceneContext,
    form: {
      values: SignUpValues;
      error: HTMLElement;
      submit: HTMLButtonElement;
      onRefused: (field: SignUpField, message: string) => void;
    },
  ): Promise<void> {
    const request = signUpRequest(form.values);

    form.submit.disabled = true;
    form.submit.textContent = "Creating account…";

    try {
      await register(request);
    } catch (caught) {
      const failure = describeSignUpFailure(caught);
      if (failure.field) form.onRefused(failure.field, failure.message);
      else form.error.textContent = failure.message;
      form.submit.disabled = false;
      form.submit.textContent = "Create account";
      return;
    }

    form.submit.textContent = "Signing in…";
    try {
      await login(request.email, request.password);
      context.goTo(SceneName.YARD);
    } catch (caught) {
      // The account exists now, so the way on is the sign-in form.
      this.showSignIn(context, {
        email: request.email,
        notice: `Your account is ready, but signing in failed: ${describe(caught)}`,
      });
    }
  }
}

/** Turns a thrown value into something worth showing a player. */
const describe = (caught: unknown): string => {
  if (caught instanceof NetworkError) {
    return "Could not reach the server. Check that it is running, then try again.";
  }
  if (caught instanceof ApiError) {
    return caught.message;
  }
  return "Something went wrong signing in. Try again.";
};
