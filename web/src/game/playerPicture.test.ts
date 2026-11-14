// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { photoUrl } from "@/api/profile";
import { avatarOf, avatarUrl } from "./avatars";
import { photoVersionOf, pictureFor, playerPicture, showPlayerPicture } from "./playerPicture";

describe("playerPicture", () => {
  it("shows the photo when the server sends a visible photo's upload number", () => {
    const picture = playerPicture(42, "/avatars/owl.webp", 3, "small");
    expect(picture).toEqual({ src: photoUrl(42, 3), photo: true, critter: avatarUrl("owl", "small") });
    // The upload number is in the address, so a new photo is never an old cached one.
    expect(picture.src).toContain("/profile/photos/42?v=3");
  });

  it("shows the critter when there is no visible photo (none, hidden, removed or blocked: null or absent)", () => {
    for (const photo of [null, undefined]) {
      expect(playerPicture(42, "/avatars/owl.webp", photo)).toEqual({
        src: avatarUrl("owl"),
        photo: false,
        critter: avatarUrl("owl"),
      });
    }
  });

  it("falls back to the player's default critter when they never picked one", () => {
    expect(playerPicture(7, null, null, "small").src).toBe(avatarUrl(avatarOf(null, 7), "small"));
  });

  it("never builds a photo address for a row with no player", () => {
    expect(playerPicture(0, null, 2).photo).toBe(false);
  });

  it("pictureFor takes an already chosen critter", () => {
    expect(pictureFor(5, "frog", 1, "full")).toEqual({ src: photoUrl(5, 1), photo: true, critter: avatarUrl("frog") });
  });
});

describe("photoVersionOf", () => {
  it("keeps whole numbers 0 or more and drops anything else", () => {
    expect(photoVersionOf(4)).toBe(4);
    expect(photoVersionOf(0)).toBe(0);
    for (const bad of [null, undefined, -1, 1.5, "3", Number.NaN, {}]) expect(photoVersionOf(bad)).toBeUndefined();
  });
});

describe("showPlayerPicture", () => {
  it("marks a photo so it fills its frame, and goes back to the critter if it will not load", () => {
    const image = document.createElement("img");
    const picture = playerPicture(42, "/avatars/owl.webp", 3, "small");
    showPlayerPicture(image, picture);
    expect(image.classList.contains("is-photo")).toBe(true);
    expect(image.getAttribute("src")).toBe(picture.src);

    image.dispatchEvent(new Event("error"));
    expect(image.classList.contains("is-photo")).toBe(false);
    expect(image.getAttribute("src")).toBe(picture.critter);
  });

  it("leaves a critter unmarked", () => {
    const image = document.createElement("img");
    image.classList.add("is-photo");
    showPlayerPicture(image, playerPicture(42, "/avatars/owl.webp", null));
    expect(image.classList.contains("is-photo")).toBe(false);
    expect(image.getAttribute("src")).toBe(avatarUrl("owl"));
  });
});
