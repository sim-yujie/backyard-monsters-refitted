// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Announcement } from "@/api/announcements";
import { isPopupOver } from "@/ui/Popup";
import { announcementText, linkPieces, paragraphsOf, safeHref } from "./announcementContent";
import { isAnnouncementOpen, openAnnouncement, openNews } from "./AnnouncementDialog";

const news = (id: number, overrides: Partial<Announcement> = {}): Announcement => ({
  id,
  title: `News ${id}`,
  body: "Hello players",
  imageIds: [],
  shownFrom: "2026-10-28T00:00:00Z",
  endsAt: null,
  dismissed: false,
  ...overrides,
});

const imageUrl = (id: number) => `/pictures/${id}.png`;

afterEach(() => {
  document.body.replaceChildren();
});

describe("the announcement's words", () => {
  it("turns only http and https addresses into links, leaving the sentence's full stop out", () => {
    expect(
      linkPieces("Play at https://play.bymrevamped.com. Chat: https://discord.gg/wthryBRZHz"),
    ).toEqual([
      { text: "Play at " },
      { text: "https://play.bymrevamped.com", href: "https://play.bymrevamped.com/" },
      { text: ". Chat: " },
      { text: "https://discord.gg/wthryBRZHz", href: "https://discord.gg/wthryBRZHz" },
    ]);
    expect(linkPieces("javascript:alert(1) and bymreborn.example")).toEqual([
      { text: "javascript:alert(1) and bymreborn.example" },
    ]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });

  it("keeps blank lines as paragraphs and single line breaks as line breaks", () => {
    expect(paragraphsOf("One\nTwo\n\n\nThree\r\n")).toEqual([["One", "Two"], ["Three"]]);
  });

  it("puts HTML the owner typed on the page as text", () => {
    const box = announcementText('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(box.querySelector("img, b")).toBeNull();
    expect(box.textContent).toBe('<img src=x onerror="alert(1)"> <b>bold</b>');
  });

  it("opens links in a new tab without handing over the game's page", () => {
    const link = announcementText("See https://bymrevamped.com").querySelector("a")!;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("https://bymrevamped.com/");
  });
});

describe("openAnnouncement", () => {
  it('shows the title, the pictures and the words, and "Got it" closes it once', () => {
    const onClose = vi.fn();
    openAnnouncement({
      container: document.body,
      announcement: news(1, {
        title: "The game is free",
        body: "Free.\n\nAlways.",
        imageIds: [7, 8],
      }),
      imageUrl,
      onClose,
    });
    expect(isAnnouncementOpen()).toBe(true);
    expect(isPopupOver(document.body)).toBe(true);
    expect(document.querySelector(".panel__title")?.textContent).toBe("The game is free");
    expect(
      [...document.querySelectorAll<HTMLImageElement>(".announcement__image")].map((img) =>
        img.getAttribute("src"),
      ),
    ).toEqual(["/pictures/7.png", "/pictures/8.png"]);
    expect(document.querySelectorAll(".announcement__paragraph")).toHaveLength(2);
    expect(document.querySelector(".announcement-dialog__step")).toBeNull();

    const done = document.querySelector<HTMLButtonElement>(".announcement-dialog__done")!;
    expect(done.textContent).toBe("Got it");
    expect(document.activeElement).toBe(done);
    done.click();
    expect(isAnnouncementOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says which one of how many when more are waiting", () => {
    openAnnouncement({
      container: document.body,
      announcement: news(1),
      step: { index: 0, total: 3 },
      imageUrl,
    });
    expect(document.querySelector(".announcement-dialog__step")?.textContent).toBe("1 / 3");
  });

  it("does not close on a tap on the scrim", () => {
    openAnnouncement({ container: document.body, announcement: news(1), imageUrl });
    document
      .querySelector(".popup-backdrop")!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(isAnnouncementOpen()).toBe(true);
  });

  it("drops a picture that does not load", () => {
    openAnnouncement({
      container: document.body,
      announcement: news(1, { imageIds: [9] }),
      imageUrl,
    });
    document.querySelector(".announcement__image")!.dispatchEvent(new Event("error"));
    expect(document.querySelector(".announcement__picture")).toBeNull();
  });
});

describe("openNews", () => {
  it("lists every current one and reports the ones not dismissed yet", async () => {
    const onSeen = vi.fn();
    openNews({
      container: document.body,
      load: () => Promise.resolve([news(2), news(1, { dismissed: true })]),
      imageUrl,
      onSeen,
    });
    expect(document.querySelector(".announcement-news__note")?.textContent).toBe("Loading…");
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".announcement-news__item")).toHaveLength(2),
    );
    expect(
      [...document.querySelectorAll(".announcement-news__title")].map((t) => t.textContent),
    ).toEqual(["News 2", "News 1"]);
    expect(onSeen).toHaveBeenCalledWith([2]);
  });

  it("says so when there is no news, or it cannot be loaded", async () => {
    openNews({ container: document.body, load: () => Promise.resolve([]), imageUrl });
    await vi.waitFor(() =>
      expect(document.querySelector(".announcement-news__note")?.textContent).toBe(
        "No news right now.",
      ),
    );
    document.body.replaceChildren();

    openNews({
      container: document.body,
      load: () => Promise.reject(new Error("offline")),
      imageUrl,
    });
    await vi.waitFor(() =>
      expect(document.querySelector(".announcement-news__note")?.textContent).toContain(
        "Could not load",
      ),
    );
  });
});
