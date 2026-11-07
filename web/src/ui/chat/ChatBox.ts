import { ApiError } from "@/api/http";
import type { ChatApi } from "@/api/chat";
import {
  ChatStatus,
  MAX_LINE_LENGTH,
  visibleEntries,
  type ChatEntry,
  type ChatLine,
  type ChatRoom,
  type ChatSession,
  type ChatState,
} from "@/game/chat/chatSession";
import { countryLabel, countryName } from "@/game/account/countries";
import { countryLabelNodes } from "@/ui/countryFlag";
import { icon } from "@/ui/icons";
import "@/ui/styles/chat.css";

/**
 * The yard's world chat box (#282): a see-through box in the top-left corner
 * showing the room's last few lines, which opens to the whole room and an
 * input. On a phone it folds to a one-line strip.
 *
 * Folded, nothing in it takes a click but its "World chat" tab, so the yard
 * under the lines can still be tapped. Open, a player's name opens a strip of
 * what can be done about them: mute or unmute (the server's ignore list), view
 * their yard, or report the line. Muted players' lines leave the box.
 *
 * The box only draws the session's state and calls back; the connection is
 * `game/chat/chatSession.ts`'s, and outlives the box. A new line is added on
 * its own, the oldest dropped as the room's history fills; every line is
 * drawn afresh only when the room, the mute list or the box's opening changes.
 *
 * A player whose country has a room (owner 3 Nov 2026) gets a second tab
 * beside Global in the open box; Global stays the default and carries a short
 * line saying it is in English.
 */

export interface ChatBoxOptions {
  readonly session: ChatSession;
  readonly api: ChatApi;
  readonly container: HTMLElement;
  /** Opens a player's yard read-only; the scene finds it and goes there. */
  readonly onViewYard: (userId: number) => Promise<void>;
}

/** What the open box says under the lines while the room is not joined. */
export const statusText = (status: ChatStatus): string | null => {
  switch (status) {
    case ChatStatus.CONNECTING:
      return "Connecting to world chat…";
    case ChatStatus.RECONNECTING:
      return "Reconnecting…";
    case ChatStatus.SIGNED_OUT:
      return "World chat is taking a nap. It will be back when your yard reloads.";
    case ChatStatus.ELSEWHERE:
      return "World chat is open in another window.";
    case ChatStatus.OFF:
      return "World chat is off.";
    default:
      return null;
  }
};

/** A finger rather than a mouse: a phone or a tablet. */
const coarsePointer = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Global's tab. */
export const GLOBAL_LABEL = "\u{1F310} Global";

/** What a room's tab says: "🌐 Global" or "🇵🇭 Philippines". */
export const roomLabel = (room: ChatRoom): string =>
  room.kind === "country" && room.country ? countryLabel(room.country) : GLOBAL_LABEL;

/** The line at the top of Global: English there, and the country room for the player's own language. */
export const globalRuleText = (hasCountryRoom: boolean): string =>
  hasCountryRoom
    ? "Global chat is in English. Use your country chat for your own language."
    : "Global chat is in English.";

const REPORTED_TEXT = "Thanks. The moderators will take a look.";
const REPORT_FAILED_TEXT = "That report could not be sent. Try again in a moment.";
const NO_YARD_TEXT = "That player's yard could not be opened.";

/**
 * How many of `before`'s newest entries start `after`, when `after` is
 * `before` with entries dropped from the front and added at the end (the
 * session's only change to a room's entries); null when it is anything else.
 */
const keptOf = (before: readonly ChatEntry[], after: readonly ChatEntry[]): number | null => {
  const last = before.at(-1);
  if (last === undefined) return null;
  const kept = after.lastIndexOf(last) + 1;
  return kept > 0 && after[0] === before[before.length - kept] ? kept : null;
};

/** The server's own words for a refusal, when it sent some. */
const failureText = (error: unknown, fallback: string): string =>
  error instanceof ApiError && typeof error.code === "string" && error.code
    ? error.code
    : fallback;

export class ChatBox {
  readonly element: HTMLElement;

  private readonly tab: HTMLButtonElement;
  private readonly tabLabel: HTMLElement;
  private readonly dot: HTMLElement;
  /** Global and the country room's tabs, shown open when there are two. */
  private readonly rooms: HTMLElement;
  /** "Global chat is in English", over Global's lines. */
  private readonly rule: HTMLElement;
  private readonly lines: HTMLOListElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly reconnect: HTMLButtonElement;
  private readonly player: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly send: HTMLButtonElement;
  private readonly unsubscribe: () => void;

  private state: ChatState;
  private open = false;
  /** The line whose speaker's strip is showing; null when none is. */
  private picked: ChatLine | null = null;
  /** The strip's question or answer, when it shows one instead of the actions. */
  private pickedNote: { text: string; confirmReport?: boolean } | null = null;
  /** What the lines were last drawn from; null before the first draw. */
  private drawn: {
    readonly entries: readonly ChatEntry[];
    readonly muted: ReadonlySet<number>;
    readonly channel: string | null;
    readonly open: boolean;
  } | null = null;

  constructor(private readonly options: ChatBoxOptions) {
    this.state = options.session.current;

    this.element = document.createElement("section");
    this.element.className = "chat-box";
    this.element.setAttribute("aria-label", "World chat");

    this.tab = document.createElement("button");
    this.tab.type = "button";
    this.tab.className = "chat-box__tab";
    this.dot = document.createElement("span");
    this.dot.className = "chat-box__dot";
    this.tabLabel = document.createElement("span");
    this.tabLabel.className = "chat-box__tab-label";
    this.tabLabel.textContent = "World chat";
    const close = icon("close", 14, "chat-box__close-icon");
    this.tab.append(this.dot, this.tabLabel, close);
    this.tab.addEventListener("click", () => this.setOpen(!this.open));

    this.rooms = document.createElement("div");
    this.rooms.className = "tab-row chat-box__rooms";
    this.rooms.setAttribute("role", "tablist");
    this.rooms.setAttribute("aria-label", "Chat rooms");
    this.rooms.hidden = true;
    this.rooms.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-room]") : null;
      const channel = button?.dataset["room"];
      if (!channel) return;
      this.pick(null);
      options.session.showRoom(channel);
    });

    this.rule = document.createElement("p");
    this.rule.className = "chat-box__rule";
    this.rule.hidden = true;

    this.lines = document.createElement("ol");
    this.lines.className = "chat-box__lines";
    this.lines.setAttribute("aria-live", "polite");
    this.lines.addEventListener("click", (event) => this.onLinesClick(event));

    this.status = document.createElement("div");
    this.status.className = "chat-box__status";
    this.statusText = document.createElement("span");
    this.reconnect = document.createElement("button");
    this.reconnect.type = "button";
    this.reconnect.className = "chat-box__link";
    this.reconnect.textContent = "Use it here";
    this.reconnect.addEventListener("click", () => options.session.reconnect());
    this.status.append(this.statusText, this.reconnect);

    this.player = document.createElement("div");
    this.player.className = "chat-box__player";
    this.player.hidden = true;

    this.form = document.createElement("form");
    this.form.className = "chat-box__form";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "chat-box__input";
    this.input.maxLength = MAX_LINE_LENGTH;
    this.input.placeholder = "Say something to the world…";
    this.input.setAttribute("aria-label", "Message to world chat");
    this.input.autocomplete = "off";
    this.send = document.createElement("button");
    this.send.type = "submit";
    this.send.className = "btn btn--primary chat-box__send";
    this.send.textContent = "Send";
    this.form.append(this.input, this.send);
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (options.session.say(this.input.value)) this.input.value = "";
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.setOpen(false);
    });

    this.element.append(this.tab, this.rooms, this.rule, this.lines, this.status, this.player, this.form);
    options.container.append(this.element);

    this.unsubscribe = options.session.subscribe((state) => this.render(state));
    this.setOpen(false);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the box to the whole room and the input, or folds it back. */
  setOpen(open: boolean): void {
    this.open = open;
    this.element.classList.toggle("chat-box--open", open);
    this.tab.setAttribute("aria-expanded", String(open));
    this.tab.title = open ? "Fold world chat away" : "Open world chat";
    if (!open) this.pick(null);
    this.render(this.state);
    if (open) {
      this.scrollToEnd();
      // Not on a touch screen: opening to read should not throw the keyboard up.
      if (!coarsePointer()) this.input.focus({ preventScroll: true });
    }
  }

  /** Steps aside while something else takes the screen (the planner). */
  setHidden(hidden: boolean): void {
    this.element.hidden = hidden;
  }

  destroy(): void {
    this.unsubscribe();
    this.element.remove();
  }

  private render(state: ChatState): void {
    const wasAtEnd =
      this.lines.scrollHeight - this.lines.scrollTop - this.lines.clientHeight < 24;
    const bounced =
      state.bounced !== null && state.bounced !== this.state.bounced ? state.bounced : null;
    this.state = state;

    const online = state.status === ChatStatus.ONLINE;
    this.element.dataset["status"] = state.status;
    this.dot.title = online ? "Connected" : (statusText(state.status) ?? "");

    this.renderRooms(state);
    this.renderLines(state);

    const words = online ? null : statusText(state.status);
    this.status.hidden = words === null;
    this.statusText.textContent = words ?? "";
    this.reconnect.hidden = state.status !== ChatStatus.ELSEWHERE;

    this.input.disabled = !online;
    this.send.disabled = !online;
    if (bounced && !this.input.value) this.input.value = bounced;

    if (this.picked && !online) this.pick(null);
    else this.renderPlayer();

    if (wasAtEnd || !this.open) this.scrollToEnd();
  }

  /** The room tabs, the folded tab's name, Global's English line and the input's words. */
  private renderRooms(state: ChatState): void {
    const shown = state.rooms.find((room) => room.channel === state.channel) ?? null;
    const country = state.rooms.find((room) => room.kind === "country") ?? null;
    const inCountry = shown?.kind === "country" && !!shown.country;

    const labelKey = inCountry && shown?.country ? shown.country : "";
    if (this.tabLabel.dataset["country"] !== labelKey) {
      this.tabLabel.dataset["country"] = labelKey;
      if (labelKey) this.tabLabel.replaceChildren(...countryLabelNodes(labelKey));
      else this.tabLabel.textContent = "World chat";
    }
    this.element.dataset["unread"] = state.unread.size > 0 ? "true" : "false";

    const two = state.rooms.length > 1;
    this.rooms.hidden = !two || !this.open;
    if (two) {
      const key = state.rooms.map((room) => `${room.channel}|${room.country}`).join(",");
      if (this.rooms.dataset["key"] !== key) {
        this.rooms.dataset["key"] = key;
        this.rooms.replaceChildren(
          ...state.rooms.map((room) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chat-box__room";
            button.setAttribute("role", "tab");
            button.dataset["room"] = room.channel;
            if (room.kind === "country" && room.country) {
              button.replaceChildren(...countryLabelNodes(room.country));
              button.title = countryName(room.country);
            } else button.textContent = roomLabel(room);
            return button;
          }),
        );
      }
      for (const button of this.rooms.querySelectorAll<HTMLElement>("[data-room]")) {
        const channel = button.dataset["room"] ?? "";
        const selected = channel === state.channel;
        button.setAttribute("aria-selected", String(selected));
        button.classList.toggle("chat-box__room--on", selected);
        button.classList.toggle("chat-box__room--unread", state.unread.has(channel));
        button.tabIndex = this.open ? 0 : -1;
      }
    } else if (this.rooms.childElementCount > 0) {
      this.rooms.replaceChildren();
      delete this.rooms.dataset["key"];
    }

    this.rule.hidden = !this.open || inCountry || state.rooms.length === 0;
    this.rule.textContent = globalRuleText(!!country);

    const where = inCountry && shown?.country ? countryName(shown.country) : null;
    this.input.placeholder = where ? `Say something to ${where}…` : "Say something to the world…";
    this.input.setAttribute("aria-label", where ? `Message to ${where} chat` : "Message to world chat");
  }

  /**
   * Brings the lines up to `state`: a line that came in is added and the ones
   * the history dropped are taken off the top; anything else (another room,
   * a mute, the box opening or folding) draws every line afresh.
   */
  private renderLines(state: ChatState): void {
    const drawn = this.drawn;
    this.drawn = { entries: state.entries, muted: state.muted, channel: state.channel, open: this.open };
    if (
      drawn &&
      drawn.muted === state.muted &&
      drawn.channel === state.channel &&
      drawn.open === this.open
    ) {
      if (drawn.entries === state.entries) return;
      const kept = keptOf(drawn.entries, state.entries);
      if (kept !== null) {
        const dropped = drawn.entries.slice(0, drawn.entries.length - kept);
        for (let gone = visibleEntries({ ...state, entries: dropped }).length; gone > 0; gone -= 1) {
          this.lines.firstElementChild?.remove();
        }
        const added = visibleEntries({ ...state, entries: state.entries.slice(kept) });
        this.lines.append(...added.map((entry) => this.entry(entry)));
        return;
      }
    }
    this.lines.replaceChildren(...visibleEntries(state).map((entry) => this.entry(entry)));
  }

  private entry(entry: ChatEntry): HTMLLIElement {
    const item = document.createElement("li");
    if (entry.kind === "notice") {
      item.className = "chat-line chat-line--notice";
      item.textContent = entry.text;
      return item;
    }
    item.className = entry.own ? "chat-line chat-line--own" : "chat-line";
    if (entry.gm) item.classList.add("chat-line--gm");
    else if (entry.mod) item.classList.add("chat-line--mod");
    item.dataset["line"] = String(entry.id);

    const name = document.createElement(entry.own ? "span" : "button");
    name.className = "chat-line__name";
    name.textContent = entry.name;
    if (name instanceof HTMLButtonElement) {
      name.type = "button";
      name.title = `${entry.name}: mute, view yard or report`;
      // Folded, the lines take no clicks; open, Tab can reach the names.
      name.tabIndex = this.open ? 0 : -1;
    }
    if (entry.own) name.title = "You";

    const body = document.createElement("span");
    body.className = "chat-line__body";
    body.textContent = entry.body;

    if (entry.gm) {
      const badge = document.createElement("span");
      badge.className = "chat-line__gm";
      badge.textContent = "GM";
      badge.title = "The game team";
      item.append(badge);
    } else if (entry.mod) {
      const badge = document.createElement("span");
      badge.className = "chat-line__mod";
      badge.textContent = "Mod";
      badge.title = "Moderator";
      item.append(badge);
    }
    item.append(name, body);
    return item;
  }

  private onLinesClick(event: MouseEvent): void {
    if (!this.open || !(event.target instanceof Element)) return;
    const name = event.target.closest("button.chat-line__name");
    const item = name?.closest<HTMLElement>(".chat-line");
    if (!item) return;
    const id = Number(item.dataset["line"]);
    const line = this.state.entries.find(
      (entry): entry is ChatLine => entry.kind === "line" && entry.id === id,
    );
    if (line && !line.own) this.pick(this.picked?.id === line.id ? null : line);
  }

  /** Shows (or, with null, hides) the strip for a line's speaker. */
  private pick(line: ChatLine | null): void {
    this.picked = line;
    this.pickedNote = null;
    this.renderPlayer();
  }

  private renderPlayer(): void {
    const line = this.picked;
    this.player.hidden = !line || !this.open;
    this.form.hidden = !this.player.hidden;
    if (!line) {
      this.player.replaceChildren();
      return;
    }

    const name = document.createElement("strong");
    name.className = "chat-box__player-name";
    name.textContent = line.name;

    const actions = document.createElement("div");
    actions.className = "chat-box__actions";
    const note = this.pickedNote;
    if (note) {
      const text = document.createElement("span");
      text.className = "chat-box__note";
      text.textContent = note.text;
      actions.append(text);
      if (note.confirmReport) {
        actions.append(
          this.button("Report", () => void this.report(line), "btn--danger"),
          this.button("Cancel", () => this.pick(line)),
        );
      } else {
        actions.append(this.button("OK", () => this.pick(null)));
      }
    } else {
      const muted = this.state.muted.has(line.userId);
      actions.append(
        this.button(muted ? "Unmute" : "Mute", () => this.toggleMute(line)),
        this.button("View yard", () => void this.viewYard(line)),
        this.button("Report", () => {
          this.pickedNote = {
            text: `Report this message from ${line.name}?`,
            confirmReport: true,
          };
          this.renderPlayer();
        }),
      );
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "chat-box__player-close";
    close.setAttribute("aria-label", "Close");
    close.append(icon("close", 14));
    close.addEventListener("click", () => this.pick(null));

    this.player.replaceChildren(name, actions, close);
  }

  private button(label: string, onClick: () => void, variant?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = variant ? `btn ${variant} chat-box__action` : "btn chat-box__action";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private toggleMute(line: ChatLine): void {
    if (this.state.muted.has(line.userId)) this.options.session.unmute(line.userId);
    else this.options.session.mute(line.userId);
    this.pick(null);
  }

  private async viewYard(line: ChatLine): Promise<void> {
    try {
      await this.options.onViewYard(line.userId);
    } catch (error) {
      if (this.picked?.id !== line.id) return;
      this.pickedNote = { text: failureText(error, NO_YARD_TEXT) };
      this.renderPlayer();
    }
  }

  private async report(line: ChatLine): Promise<void> {
    const channel = this.state.channel;
    if (!channel) return;
    this.pickedNote = { text: "Sending…" };
    this.renderPlayer();
    let text = REPORTED_TEXT;
    try {
      await this.options.api.report({
        userId: line.userId,
        channel,
        body: line.body,
        ts: line.ts,
      });
    } catch (error) {
      text = failureText(error, REPORT_FAILED_TEXT);
    }
    if (this.picked?.id !== line.id) return;
    this.pickedNote = { text };
    this.renderPlayer();
  }

  private scrollToEnd(): void {
    this.lines.scrollTop = this.lines.scrollHeight;
  }
}
