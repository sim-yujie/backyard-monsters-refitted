import { friendsApi, type FriendsApi } from "@/api/friends";
import { friendsStore as sharedStore, type FriendsStore } from "@/game/friends/friendsStore";
import { Panel } from "@/ui/Panel";
import { FindTab } from "./FindTab";
import { FriendsTab, type FriendActions } from "./FriendsTab";
import { RequestsTab } from "./RequestsTab";
import { make, type FriendsTabView } from "./rows";
import "./friends.css";

/**
 * The Friends screen (`docs/design/friends.md` §3.1 and §8, issue #370): a
 * docked panel like the achievements screen, a full-height sheet on a phone,
 * with the tabs **Friends**, **Requests** and **Find**. Each tab lives in its
 * own file; Gifts (WP8) slots in between Requests and Find with one line in
 * {@link FRIENDS_TABS} and one in the constructor.
 *
 * Requests carries the count of requests waiting, from the store. Every time
 * a tab comes forward it fetches fresh.
 */

export type FriendsTabId = "friends" | "requests" | "gifts" | "find";

/** The tabs in their order, and their names. Gifts has its slot here once WP8 adds it. */
export const FRIENDS_TABS: readonly { readonly id: FriendsTabId; readonly label: string }[] = [
  { id: "friends", label: "Friends" },
  { id: "requests", label: "Requests" },
  { id: "find", label: "Find" },
];

export interface FriendsScreenOptions extends FriendActions {
  readonly api?: FriendsApi;
  readonly store?: FriendsStore;
  /** After it closes; `hadFocus` when focus was inside it, so the opener can take it back. */
  readonly onClose?: (hadFocus: boolean) => void;
  /** Unix seconds now, for a test. */
  readonly now?: () => number;
  /** The Find tab's typing pause, for a test. */
  readonly debounceMs?: number;
}

export class FriendsScreen {
  readonly element: HTMLElement;

  private readonly options: FriendsScreenOptions;
  private readonly store: FriendsStore;
  private readonly tabs = new Map<FriendsTabId, FriendsTabView>();
  private readonly tabButtons = new Map<FriendsTabId, HTMLButtonElement>();
  private readonly body: HTMLElement;
  private readonly unsubscribe: () => void;
  private active: FriendsTabId = "friends";
  private opened = false;
  private destroyed = false;

  constructor(options: FriendsScreenOptions = {}) {
    this.options = options;
    const api = options.api ?? friendsApi;
    this.store = options.store ?? sharedStore;

    // Not Panel's own close, which removes the element for good: the screen
    // opens and closes many times over one scene.
    const panel = new Panel({ title: "Friends", className: "friends-screen", closable: false });
    this.element = panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    const close = make("button", "btn btn--ghost btn--icon friends-screen__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close Friends");
    close.addEventListener("click", () => this.close());
    panel.titlebar.append(close);

    this.tabs.set(
      "friends",
      new FriendsTab({
        api,
        store: this.store,
        onFind: () => void this.open("find"),
        ...(options.onVisit && { onVisit: options.onVisit }),
        ...(options.onGift && { onGift: options.onGift }),
      }),
    );
    this.tabs.set("requests", new RequestsTab({ api, store: this.store, ...(options.now && { now: options.now }) }));
    this.tabs.set(
      "find",
      new FindTab({ api, store: this.store, ...(options.debounceMs !== undefined && { debounceMs: options.debounceMs }) }),
    );

    const strip = make("div", "tabs friends-tabs");
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Friends");
    for (const { id, label } of FRIENDS_TABS) {
      if (!this.tabs.has(id)) continue;
      const tab = make("button", "tabs__tab friends-tabs__tab");
      tab.type = "button";
      tab.id = `friends-tab-${id}`;
      tab.dataset["tab"] = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "friends-body");
      tab.append(make("span", "friends-tabs__label", label), make("span", "friends-tabs__count"));
      tab.addEventListener("click", () => void this.open(id));
      strip.append(tab);
      this.tabButtons.set(id, tab);
    }
    strip.addEventListener("keydown", (event) => this.onStripKey(event));

    this.body = make("div", "friends-body");
    this.body.id = "friends-body";
    this.body.setAttribute("role", "tabpanel");
    panel.setContent(strip, this.body);

    this.unsubscribe = this.store.subscribe((snapshot) => this.setCount("requests", snapshot.requestsIn));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeTab(): FriendsTabId {
    return this.active;
  }

  /** A tab's view, for a test. */
  tab<T extends FriendsTabView>(id: FriendsTabId): T | undefined {
    return this.tabs.get(id) as T | undefined;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Opens the screen on `tab` (or brings that tab forward), fetching it fresh. */
  async open(tab: FriendsTabId = this.active): Promise<void> {
    if (this.destroyed) return;
    const view = this.tabs.get(tab);
    if (!view) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.active = tab;
    this.element.dataset["tab"] = tab;
    for (const [id, button] of this.tabButtons) {
      const on = id === tab;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `friends-tab-${tab}`);
    this.body.replaceChildren(view.element);
    if (!wasOpen) this.element.querySelector<HTMLElement>(".friends-screen__close")?.focus();
    if (tab === "find" && view instanceof FindTab) view.searchInput.focus();
    await view.show();
  }

  close(): void {
    if (!this.opened) return;
    const hadFocus = this.element.contains(document.activeElement);
    this.opened = false;
    this.element.hidden = true;
    this.options.onClose?.(hadFocus);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    for (const view of this.tabs.values()) view.destroy();
    this.element.remove();
  }

  /** A tab's count beside its name; none at 0. */
  private setCount(id: FriendsTabId, count: number): void {
    const button = this.tabButtons.get(id);
    const badge = button?.querySelector<HTMLElement>(".friends-tabs__count");
    if (!button || !badge) return;
    badge.textContent = count > 0 ? String(count > 99 ? "99+" : count) : "";
    badge.hidden = count === 0;
    const label = FRIENDS_TABS.find((one) => one.id === id)?.label ?? id;
    button.setAttribute("aria-label", count > 0 ? `${label}, ${count} waiting` : label);
  }

  private onStripKey(event: KeyboardEvent): void {
    const ids = [...this.tabButtons.keys()];
    const at = ids.indexOf(this.active);
    const next =
      event.key === "ArrowRight"
        ? ids[(at + 1) % ids.length]
        : event.key === "ArrowLeft"
          ? ids[(at - 1 + ids.length) % ids.length]
          : event.key === "Home"
            ? ids[0]
            : event.key === "End"
              ? ids[ids.length - 1]
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    void this.open(next);
    this.tabButtons.get(next)?.focus();
  }
}
