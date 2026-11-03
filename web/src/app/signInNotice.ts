/**
 * Words for the next sign-in screen, left by whatever signed the player out
 * (a ban from the game team, `App.ts`). Taken once.
 */

let pending: string | null = null;

export const setSignInNotice = (text: string): void => {
  pending = text;
};

export const takeSignInNotice = (): string | null => {
  const text = pending;
  pending = null;
  return text;
};
