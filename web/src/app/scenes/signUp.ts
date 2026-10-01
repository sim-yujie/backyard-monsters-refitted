import { ApiError, NetworkError } from "@/api/http";
import type { RegisterRequest } from "@/api/types";
import {
  USERNAME_MAX_LENGTH,
  USERNAME_PATTERN,
  emailProblem,
  isReservedUsername,
  passwordProblem,
  usernameProblem,
} from "@/game/account/rules/accountRules";

/**
 * The sign-up form's rules and wording (issue #213), apart from its DOM so they
 * can be tested. The checks are the shared account rules the server's
 * registration schema is built from, so what passes here the server takes;
 * only "the two passwords match" is the form's own.
 */

export type SignUpField = "username" | "email" | "password" | "confirm";

export type SignUpValues = Record<SignUpField, string>;

export const SIGN_UP_FIELDS: readonly SignUpField[] = [
  "username",
  "email",
  "password",
  "confirm",
];

/** What each field asks for, shown under it until the player gets it wrong. */
export const SIGN_UP_HINTS: Record<SignUpField, string> = {
  username: "2 to 12 letters, numbers or underscores. Other players see it.",
  email: "Used to sign in. Never shown to other players.",
  password: "At least 8 characters, with a symbol such as ! or #.",
  confirm: "Type the password again.",
};

export const PASSWORDS_DIFFER = "The two passwords are not the same.";

/** Each field's problem, or null where it is fine. */
export const signUpProblems = (values: SignUpValues): Record<SignUpField, string | null> => ({
  username: usernameProblem(values.username),
  email: emailProblem(values.email),
  password: passwordProblem(values.password),
  confirm: values.confirm === values.password ? null : PASSWORDS_DIFFER,
});

/**
 * Whether a field's problem is already certain, so it is worth showing while
 * the player is still typing. "Too short" is not: more letters may fix it, and
 * saying so on the first keystroke only nags. A space in a username, a
 * thirteenth letter, or a confirmation that has stopped matching the password
 * so far cannot be fixed by typing on. A reserved name ("admin") is shown at
 * once too, so the player knows before they finish the form.
 */
export const isDefiniteProblem = (field: SignUpField, values: SignUpValues): boolean => {
  switch (field) {
    case "username": {
      const username = values.username.trim();
      if (username.length > USERNAME_MAX_LENGTH) return true;
      return (
        username.length > 0 && (!USERNAME_PATTERN.test(username) || isReservedUsername(username))
      );
    }
    case "confirm":
      return !values.password.startsWith(values.confirm);
    default:
      return false;
  }
};

/**
 * The fields exactly as the register route wants them: trimmed, the email
 * lower case. The form shows the Terms and age line under its button, so
 * sending it is agreeing to them; the Turnstile token goes along when the
 * form has one, and `sandboxStart` only when the dev-only test yard box was
 * ticked (issue #217).
 */
export const signUpRequest = (
  values: SignUpValues,
  turnstileToken?: string,
  sandboxStart = false,
): RegisterRequest => ({
  username: values.username.trim(),
  email: values.email.trim().toLowerCase(),
  password: values.password,
  termsAccepted: true,
  ...(turnstileToken ? { turnstileToken } : {}),
  ...(sandboxStart ? { sandboxStart: true } : {}),
});

/** The dev-only sign-up box's words (issue #217). */
export const SANDBOX_START_LABEL = "Start with the test yard (dev)";
export const SANDBOX_START_TITLE =
  "Your first yard is the maxed test yard instead of the normal new-player start. Only a dev server offers it.";

/** Shown when the player presses Create account before the bot check has finished. */
export const BOT_CHECK_PENDING = "Please wait for the check above to finish, then try again.";

export interface SignUpFailure {
  /** The field to mark, or null for a message about the whole form. */
  field: SignUpField | null;
  message: string;
}

const isField = (value: unknown): value is SignUpField =>
  typeof value === "string" && (SIGN_UP_FIELDS as readonly string[]).includes(value);

/** Turns a refused sign-up into something worth showing a player, and where. */
export const describeSignUpFailure = (caught: unknown): SignUpFailure => {
  if (caught instanceof NetworkError) {
    return {
      field: null,
      message: "Could not reach the server. Check your connection, then try again.",
    };
  }
  if (!(caught instanceof ApiError)) {
    return { field: null, message: "Something went wrong creating your account. Try again." };
  }
  if (caught.status === 429) {
    return {
      field: null,
      message: "Too many accounts were made from your network just now. Try again later.",
    };
  }

  const data = (caught.details?.data ?? {}) as { reason?: unknown; field?: unknown };
  switch (data.reason) {
    case "usernameTaken":
      return { field: "username", message: "That username is taken. Try another one." };
    case "emailTaken":
      return {
        field: "email",
        message: "An account already uses this email. Sign in with it instead.",
      };
    case "invalidAccount":
      return { field: isField(data.field) ? data.field : null, message: caught.message };
    default:
      return { field: null, message: caught.message };
  }
};
