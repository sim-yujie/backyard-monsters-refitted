import { login } from "@/api/auth";
import { ApiError, NetworkError } from "@/api/http";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/** Builds a labelled input row. */
const field = (
  id: string,
  label: string,
  type: string,
  autocomplete: AutoFill,
): { wrapper: HTMLElement; input: HTMLInputElement } => {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const labelElement = document.createElement("label");
  labelElement.className = "field__label";
  labelElement.htmlFor = id;
  labelElement.textContent = label;

  const input = document.createElement("input");
  input.className = "field__input";
  input.id = id;
  input.name = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;

  wrapper.append(labelElement, input);
  return { wrapper, input };
};

/**
 * The sign-in form, rendered as HTML over an empty canvas.
 *
 * The password rules mirror the server's schema (at least 8 characters with one
 * non-alphanumeric) so an obvious mistake is caught before a round trip, but
 * the server stays the authority.
 */
export class LoginScene implements Scene {
  private panel: Panel | null = null;
  private wrapper: HTMLElement | null = null;

  enter(context: SceneContext): void {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "scene-centre";

    const form = document.createElement("form");
    form.className = "login-form";
    form.noValidate = true;

    const email = field("email", "Email", "email", "username");
    const password = field("password", "Password", "password", "current-password");

    const error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn--primary";
    submit.textContent = "Play";

    form.append(email.wrapper, password.wrapper, error, submit);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(context, {
        email: email.input.value.trim(),
        password: password.input.value,
        error,
        submit,
      });
    });

    this.panel = new Panel({ title: "Sign in", closable: false });
    this.panel.setContent(form);

    this.wrapper.append(this.panel.element);
    context.overlay.content.append(this.wrapper);

    email.input.focus();
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
    this.wrapper?.remove();
    this.wrapper = null;
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
      context.goTo(SceneName.MAP_ROOM_2);
    } catch (caught) {
      form.error.textContent = describe(caught);
      form.submit.disabled = false;
      form.submit.textContent = "Play";
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
