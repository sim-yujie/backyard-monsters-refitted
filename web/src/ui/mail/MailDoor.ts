import type { MailApi } from "@/api/mail";
import type { OffsetCell } from "@/game/HexGrid";
import { MailButton, type MailButtonStyle } from "./MailButton";
import { MailboxScreen, type ComposeTarget, type InviteTarget, type TruceTarget } from "./MailboxScreen";

/**
 * A screen's way into the mailbox (#193): the Mail button, the mailbox screen
 * behind it (made the first time it opens), and what the button's badge says.
 *
 * The badge starts from the save's `unreadmessages`, the count the server
 * keeps. Once the mailbox has fetched the threads it shows how many of them
 * are still unread, since opening one marks it read on the server; the next
 * save the scene hands over (`setSaveUnread`) with a different count than the
 * last takes over again, as the server's own recount.
 */

export interface MailDoorOptions {
  readonly style: MailButtonStyle;
  /** Where the screen docks: the scene's overlay content. */
  readonly container: HTMLElement;
  /** Before the screen opens: the scene closes whatever else docks there. */
  readonly onOpen?: () => void;
  /** A notice's "Show on map". */
  readonly onShowOnMap?: (cell: OffsetCell) => void;
  /** A truce was accepted in the mailbox (#203): the map's truce marks are out of date. */
  readonly onTruceAccepted?: () => void;
  /** An invitation to move was accepted in the mailbox (#205): the main yard is at `coords` now. */
  readonly onInviteAccepted?: (coords: readonly [number, number] | null) => void;
  /** An invitation to move was sent or withdrawn (#205): the map's pending marks are out of date. */
  readonly onInviteChanged?: () => void;
  /** The mail routes, for a test. */
  readonly api?: MailApi;
}

export class MailDoor {
  readonly button: MailButton;

  private readonly options: MailDoorOptions;
  private screen: MailboxScreen | null = null;
  private saveCount: number | null = null;
  private mailboxCount: number | null = null;

  constructor(options: MailDoorOptions) {
    this.options = options;
    this.button = new MailButton({ style: options.style, onOpen: () => void this.open() });
  }

  get isOpen(): boolean {
    return this.screen?.isOpen ?? false;
  }

  /** The count the latest save says; a new one takes over from the mailbox's. */
  setSaveUnread(count: number | undefined): void {
    const next = Math.max(0, Math.floor(Number(count) || 0));
    if (next === this.saveCount) return;
    this.saveCount = next;
    this.mailboxCount = null;
    this.show();
  }

  async open(): Promise<void> {
    this.options.onOpen?.();
    await this.ensureScreen().open();
  }

  /** A new message to a player the map named (their yard's Message). */
  async openCompose(to: ComposeTarget): Promise<void> {
    this.options.onOpen?.();
    await this.ensureScreen().openCompose(to);
  }

  /** A truce proposed to the owner of a yard the map showed (#203). */
  async openTruce(to: TruceTarget): Promise<void> {
    this.options.onOpen?.();
    await this.ensureScreen().openTruce(to);
  }

  /** An invitation to move onto one of the player's outposts, from the map (#205). */
  async openInvite(target: InviteTarget): Promise<void> {
    this.options.onOpen?.();
    await this.ensureScreen().openInvite(target);
  }

  close(): void {
    this.screen?.close();
  }

  destroy(): void {
    this.screen?.destroy();
    this.screen = null;
    this.button.destroy();
  }

  private ensureScreen(): MailboxScreen {
    this.screen ??= new MailboxScreen({
      ...(this.options.api ? { api: this.options.api } : {}),
      ...(this.options.onShowOnMap ? { onShowOnMap: this.options.onShowOnMap } : {}),
      ...(this.options.onTruceAccepted ? { onTruceAccepted: this.options.onTruceAccepted } : {}),
      ...(this.options.onInviteAccepted ? { onInviteAccepted: this.options.onInviteAccepted } : {}),
      ...(this.options.onInviteChanged ? { onInviteChanged: this.options.onInviteChanged } : {}),
      onUnreadChange: (count) => {
        this.mailboxCount = count;
        this.show();
      },
      onClose: (hadFocus) => {
        if (hadFocus) this.button.element.focus();
      },
    }).mount(this.options.container);
    return this.screen;
  }

  private show(): void {
    this.button.setCount(this.mailboxCount ?? this.saveCount ?? 0);
  }
}
