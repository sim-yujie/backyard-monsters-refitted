// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { ChangelogRelease } from "@/data/changelog";
import { isWhatsNewOpen, openWhatsNew } from "./WhatsNewDialog";

const release: ChangelogRelease = {
  version: "2.0.0-beta.4",
  title: "Beta 4",
  cards: [{ image: "/halloween.png", title: "Halloween is here!", text: "Spooky." }],
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("isWhatsNewOpen", () => {
  it("is true while the cards are up and false once they close, so Bob's tips wait for them", () => {
    expect(isWhatsNewOpen()).toBe(false);
    const popup = openWhatsNew({ container: document.body, releases: [release] });
    expect(popup).not.toBeNull();
    expect(isWhatsNewOpen()).toBe(true);

    document.querySelector<HTMLButtonElement>(".whats-new__done")!.click();
    expect(isWhatsNewOpen()).toBe(false);
  });

  it("stays false when there is no release to show", () => {
    expect(openWhatsNew({ container: document.body, releases: [] })).toBeNull();
    expect(isWhatsNewOpen()).toBe(false);
  });
});
