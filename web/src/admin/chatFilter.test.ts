// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The dashboard's Chat filter tab (owner, 24 Nov 2026, dashboard option A). */

const api = vi.hoisted(() => ({
  fetchWatchWords: vi.fn(),
  addWatchWord: vi.fn(),
  removeWatchWord: vi.fn(),
}));
vi.mock("./api", () => api);

const { ChatFilterView } = await import("./chatFilter");

const WORDS = [
  { id: 1, word: "private server", kind: "always", hits: 14 },
  { id: 2, word: "telegram", kind: "always", hits: 1 },
  { id: 6, word: "fb", kind: "near", hits: 4 },
  { id: 7, word: "facebook", kind: "near", hits: 2 },
  { id: 8, word: "group", kind: "context", hits: null },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  api.fetchWatchWords.mockResolvedValue({ ok: true, words: WORDS, days: 7 });
  api.addWatchWord.mockReset();
  api.removeWatchWord.mockReset();
});

describe("the Chat filter tab", () => {
  it("shows the two cards: always-watched words with their hits, and the words only watched next to others", async () => {
    const view = new ChatFilterView({ say: vi.fn() });
    document.body.append(view.element);
    await view.refresh();
    expect(view.element.textContent).toContain("Live · changes apply within 1 min");
    const rows = [...view.element.querySelectorAll(".watch-row")].map((row) => row.querySelector(".row-title")!.textContent + "|" + row.querySelector(".row-meta")!.textContent);
    expect(rows).toEqual(["private server|14 hits in 7 days", "telegram|1 hit in 7 days"]);
    expect([...view.element.querySelectorAll(".watch-chip--near")].map((c) => c.textContent)).toEqual(["fb", "facebook"]);
    expect([...view.element.querySelectorAll(".watch-chip--context")].map((c) => c.textContent)).toEqual(["group"]);
    expect(view.element.querySelector(".watch-near-hits")!.textContent).toBe("6 hits in 7 days (fb 4, facebook 2)");
  });

  it("adds a word and removes one", async () => {
    const say = vi.fn();
    const view = new ChatFilterView({ say });
    document.body.append(view.element);
    await view.refresh();
    api.addWatchWord.mockResolvedValue({ ok: true, word: { id: 9, word: "pampa", kind: "always", hits: 0 } });
    const form = view.element.querySelector<HTMLFormElement>('[data-add="always"]')!;
    form.querySelector("input")!.value = "pampa";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(api.addWatchWord).toHaveBeenCalledWith("pampa", "always");
    expect(view.element.textContent).toContain("pampa");
    api.removeWatchWord.mockResolvedValue({ ok: true, removed: 2 });
    view.element.querySelector<HTMLButtonElement>('[aria-label="Remove “telegram”"]')!.click();
    await settle();
    expect(api.removeWatchWord).toHaveBeenCalledWith(2);
    expect(view.element.textContent).not.toContain("telegram");
    expect(say).toHaveBeenCalledWith("“telegram” is no longer watched");
  });

  it("an empty word is refused without asking the server", async () => {
    const view = new ChatFilterView({ say: vi.fn() });
    document.body.append(view.element);
    await view.refresh();
    view.element.querySelector<HTMLFormElement>('[data-add="context"]')!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(api.addWatchWord).not.toHaveBeenCalled();
    expect(view.element.querySelector(".form-error")!.textContent).toBe("Type one word.");
  });
});
