import { passwordProblem } from "@/game/account/rules/accountRules";
import { PASSWORDS_DIFFER } from "./signUp";

/** The path the emailed reset link opens (`server/.../forgotPassword.ts`). */
export const RESET_PATH = "/reset-password";

/**
 * The reset token in a page address, or null when the page is not a reset
 * link. Only the path and `token` count; the token itself is checked by the
 * server when the new password is sent.
 */
export const resetTokenFromLocation = (location: Pick<Location, "pathname" | "search">): string | null => {
  if (location.pathname.replace(/\/+$/, "") !== RESET_PATH) return null;
  const token = new URLSearchParams(location.search).get("token")?.trim();
  return token ? token : null;
};

/** Takes the reset link out of the address bar, so a reload does not reopen it. */
export const clearResetLink = (): void => {
  try {
    history.replaceState(null, "", "/");
  } catch {
    // An address that cannot be rewritten stays; the form still works.
  }
};

/** The first thing wrong with a new password pair, or null when it can be sent. */
export const resetProblem = (password: string, confirm: string): string | null =>
  passwordProblem(password) ?? (password !== confirm ? PASSWORDS_DIFFER : null);

export const FORGOT_INTRO = "Enter your account email and we will send a link to set a new password.";
export const RESET_DONE = "Your password is changed. Sign in with the new one.";
export const RESET_EXPIRED = "This reset link has expired or was already used. Ask for a new one.";
