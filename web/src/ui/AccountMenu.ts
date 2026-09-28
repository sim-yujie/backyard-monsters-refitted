/**
 * The HUD's Account control (issue #173): a button that opens a short menu
 * with who is signed in and an explicit Log out.
 *
 * "Account" used to be one of the screen tabs, and the screen it opened was
 * the sign-in form: nothing signed the player out, but the game vanished
 * behind an empty Email and Password, which reads as exactly that. Signing out
 * is now a thing the player asks for by name, and Account only shows who they
 * are.
 *
 * Built like the attack's phone menu (`AttackMenu`): it only reports that Log
 * out was picked, and a press elsewhere or Escape closes it.
 */

export interface AccountMenuOptions {
  /** The signed-in player's name; null or empty when the server sent none. */
  readonly name: string | null | undefined;
  readonly onSignOut: () => void;
}

/** What the menu's heading says: the name, or a plain stand-in without one. */
export const accountName = (name: string | null | undefined): string => name?.trim() || "Signed in";

export class AccountMenu {
  /** The button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;

  constructor(options: AccountMenuOptions) {
    this.element = document.createElement("div");
    this.element.className = "account-menu";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn btn--ghost account-menu__button";
    this.button.textContent = "Account";
    this.button.setAttribute("aria-haspopup", "true");
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", () => this.toggle(this.list.hidden));

    this.list = document.createElement("div");
    this.list.className = "account-menu__list";
    this.list.setAttribute("role", "menu");
    this.list.setAttribute("aria-label", "Account");
    this.list.hidden = true;

    const who = document.createElement("div");
    who.className = "account-menu__who";
    const label = document.createElement("span");
    label.className = "account-menu__label";
    label.textContent = "Signed in as";
    const name = document.createElement("span");
    name.className = "account-menu__name";
    name.textContent = accountName(options.name);
    who.append(label, name);

    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.className = "btn btn--ghost account-menu__item";
    signOut.setAttribute("role", "menuitem");
    signOut.textContent = "Log out";
    signOut.addEventListener("click", () => {
      this.toggle(false);
      options.onSignOut();
    });

    this.list.append(who, signOut);
    this.element.append(this.button, this.list);
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    this.element.remove();
  }

  private toggle(open: boolean): void {
    this.list.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  /** A press anywhere else, or Escape, closes the list. */
  private readonly dismiss = (event: Event): void => {
    if (this.list.hidden) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      this.toggle(false);
      this.button.focus();
      return;
    }
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.toggle(false);
  };
}
