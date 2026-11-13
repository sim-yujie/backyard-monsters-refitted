// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openProfile } from "@/ui/profile/ProfileDialog";
import { playerRow } from "./rows";

vi.mock("@/ui/profile/ProfileDialog", () => ({ openProfile: vi.fn() }));

describe("a friends row's face", () => {
  it("is a button that opens that player's profile", () => {
    const row = playerRow({ userid: 42, username: "pal", pic: null, level: 9 });
    const face = row.querySelector<HTMLButtonElement>("button.friends-row__face-button")!;
    expect(face.getAttribute("aria-label")).toBe("pal: profile");
    face.click();
    expect(vi.mocked(openProfile)).toHaveBeenCalledWith(expect.objectContaining({ userid: 42 }));
  });

  const img = (row: HTMLElement) => row.querySelector<HTMLImageElement>("img.friends-row__face")!;

  it("shows the player's uploaded photo when the server says others may see it", () => {
    const face = img(playerRow({ userid: 42, username: "pal", pic: "/avatars/owl.webp", level: 9, photo: 3 }));
    expect(face.getAttribute("src")).toMatch(/\/profile\/photos\/42\?v=3$/);
    expect(face.classList.contains("is-photo")).toBe(true);
  });

  it("shows the critter when the photo is hidden or there is none, and when the photo will not load", () => {
    for (const photo of [null, undefined]) {
      const face = img(playerRow({ userid: 42, username: "pal", pic: "/avatars/owl.webp", level: 9, photo }));
      expect(face.getAttribute("src")).toMatch(/avatars\/owl-64\.webp$/);
      expect(face.classList.contains("is-photo")).toBe(false);
    }
    const face = img(playerRow({ userid: 42, username: "pal", pic: "/avatars/owl.webp", level: 9, photo: 3 }));
    face.dispatchEvent(new Event("error"));
    expect(face.getAttribute("src")).toMatch(/avatars\/owl-64\.webp$/);
    expect(face.classList.contains("is-photo")).toBe(false);
  });
});
