/**
 * The account's "Smart moving" setting (beta 9, owner 24 Nov 2026): on by
 * default, kept on the account (`user.smart_moving_off`, sent as
 * `smartMoving` in the settings block) so it holds on every device.
 *
 * This page keeps the account's last answer, so the map's Attack skips the
 * offer's request altogether while it is off. Until the account has answered
 * it reads on, as the account does by default; the server checks the account
 * itself whatever this page thinks.
 */

let on = true;

/** Whether this page last heard the setting on. */
export const smartMovingOn = (): boolean => on;

/** Records the account's answer (`settings.smartMoving`); anything but `false` reads on. */
export const noteSmartMoving = (value: unknown): void => {
  on = value !== false;
};
