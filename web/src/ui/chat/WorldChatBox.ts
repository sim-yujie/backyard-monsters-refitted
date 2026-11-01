import { onWorldChatChange, worldChatOn } from "@/game/chat/worldChatSetting";
import { ChatBox, type ChatBoxOptions } from "./ChatBox";

/**
 * World chat's place on a screen, following the player's "World chat" switch
 * (owner, 1 Nov 2026): the chat box while it is on, nothing at all while it is
 * off. Turned on again, the box comes back in the same place without a reload.
 *
 * The connection follows the same switch on its own (`worldChat`); this is
 * only the box.
 */
export class WorldChatBox {
  private box: ChatBox | null = null;
  /** Stepped aside for something that takes the screen (the planner). */
  private hidden = false;
  /** Where the box goes, so one made later sits where the first one did. */
  private readonly anchor: Comment;
  private readonly stopListening: () => void;

  constructor(private readonly options: ChatBoxOptions) {
    this.anchor = document.createComment("world chat");
    options.container.append(this.anchor);
    this.sync(worldChatOn());
    this.stopListening = onWorldChatChange((on) => this.sync(on));
  }

  /** The box, while world chat is on. */
  get current(): ChatBox | null {
    return this.box;
  }

  setOpen(open: boolean): void {
    this.box?.setOpen(open);
  }

  /** Steps aside while something else takes the screen (the planner). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.box?.setHidden(hidden);
  }

  destroy(): void {
    this.stopListening();
    this.box?.destroy();
    this.box = null;
    this.anchor.remove();
  }

  private sync(on: boolean): void {
    if (on && !this.box) {
      const box = new ChatBox(this.options);
      this.anchor.after(box.element);
      box.setHidden(this.hidden);
      this.box = box;
    } else if (!on && this.box) {
      this.box.destroy();
      this.box = null;
    }
  }
}
