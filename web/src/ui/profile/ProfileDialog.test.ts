// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/api/profile";
import { ApiError } from "@/api/http";
import { cropSquare, MAX_ZOOM } from "./PhotoCropper";
import {
  BIO_SAVED,
  LOAD_FAILED,
  NO_BIO,
  PHOTO_HIDDEN,
  REPORTED,
  openProfile,
  photoNote,
  pictureOf,
  type ProfileApi,
} from "./ProfileDialog";

/**
 * The profile window, driven through its DOM with the calls stubbed: the
 * critter when there is no photo, the photo when there is, stats as icons,
 * the own bio editor and photo buttons with their notes, and the report step
 * on someone else's photo.
 */

const profileOf = (extra: Partial<Profile> = {}): Profile => ({
  userid: 2503,
  username: "yardtester",
  pic: null,
  bio: "Hello there",
  photoVersion: null,
  stats: {
    level: 34,
    townHall: 8,
    empirePoints: 123456,
    achievements: { earned: 5, total: 22 },
    friends: 3,
    joined: "2026-03-04T00:00:00.000Z",
    alliance: null,
  },
  own: false,
  reported: false,
  photoState: null,
  ...extra,
});

const ownState = {
  hidden: false,
  blocked: false,
  canUpload: true,
  reason: null,
  nextAt: null,
  minLevel: 10,
} as const;

let container: HTMLElement;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const apiWith = (profile: Profile | Error, extra: Partial<ProfileApi> = {}): ProfileApi => ({
  fetchProfile: vi.fn(() => (profile instanceof Error ? Promise.reject(profile) : Promise.resolve(profile))),
  saveBio: vi.fn((bio: string) => Promise.resolve(bio.trim())),
  uploadPhoto: vi.fn(() => Promise.resolve(profileOf({ own: true, photoVersion: 1, photoState: ownState }))),
  removePhoto: vi.fn(() => Promise.resolve(profileOf({ own: true, photoState: ownState }))),
  reportPhoto: vi.fn(() => Promise.resolve(false)),
  ...extra,
});

const open = async (api: ProfileApi, userid = 2503) => {
  const dialog = openProfile({ container, userid, api });
  await flush();
  return dialog;
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => container.querySelector<T>(selector);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  container.remove();
});

describe("profile window", () => {
  it("shows the critter, name, bio and stats of another player", async () => {
    await open(apiWith(profileOf()));
    expect(q(".profile__name")?.textContent).toBe("yardtester");
    expect(q<HTMLImageElement>(".profile__image")?.src).toContain("/avatars/");
    expect(q(".profile__picture--photo")).toBeNull();
    expect(q(".profile__bio")?.textContent).toBe("Hello there");
    const stats = [...container.querySelectorAll(".profile__stat")].map((item) => item.getAttribute("aria-label"));
    expect(stats).toContain("Level: 34");
    expect(stats).toContain("Town Hall: 8");
    expect(stats).toContain("Achievements: 5/22");
    expect(stats).toContain("Friends: 3");
    // Every stat but achievements (its medal) is a painted icon, never a line icon (owner, 7 Nov).
    const icons = [...container.querySelectorAll<HTMLImageElement>(".profile__stat-icon .game-icon")];
    expect(icons.map((icon) => icon.dataset["icon"])).toEqual(["levelup", "townhall", "empire", "friends", "time"]);
    expect(q(".profile__stat-icon svg")).toBeNull();
    // No photo, so nothing to report; no editor on someone else's profile.
    expect(q(".profile__report")).toBeNull();
    expect(q(".profile__bio-input")).toBeNull();
  });

  it("says when another player has no bio", async () => {
    await open(apiWith(profileOf({ bio: "" })));
    expect(q(".profile__bio--empty")?.textContent).toBe(NO_BIO);
  });

  it("shows the photo by its versioned address when there is one", async () => {
    await open(apiWith(profileOf({ photoVersion: 4 })));
    expect(q<HTMLImageElement>(".profile__image")?.src).toMatch(/\/profile\/photos\/2503\?v=4$/);
    expect(q(".profile__picture--photo")).not.toBeNull();
    expect(pictureOf(profileOf({ photoVersion: null })).photo).toBe(false);
  });

  it("asks before reporting a photo, then marks it reported", async () => {
    const api = apiWith(profileOf({ photoVersion: 2 }));
    await open(api);
    q<HTMLButtonElement>(".profile__report-open")?.click();
    expect(api.reportPhoto).not.toHaveBeenCalled();
    q<HTMLButtonElement>(".profile__report-yes")?.click();
    await flush();
    expect(api.reportPhoto).toHaveBeenCalledWith(2503);
    expect(q(".profile__reported")?.textContent).toBe(REPORTED);
  });

  it("Cancel puts the Report button back", async () => {
    await open(apiWith(profileOf({ photoVersion: 2 })));
    q<HTMLButtonElement>(".profile__report-open")?.click();
    q<HTMLButtonElement>(".profile__report-no")?.click();
    expect(q(".profile__report-open")).not.toBeNull();
  });

  it("shows Reported straight away for a photo already reported", async () => {
    await open(apiWith(profileOf({ photoVersion: 2, reported: true })));
    expect(q(".profile__reported")?.textContent).toBe(REPORTED);
    expect(q(".profile__report-open")).toBeNull();
  });

  it("says so when the profile will not load", async () => {
    await open(apiWith(new Error("Could not reach http://x")));
    expect(q(".profile__status--error")?.textContent).toBe(LOAD_FAILED);
  });

  it("shows the server's own words for a refusal", async () => {
    await open(apiWith(new ApiError("That player could not be found.", { status: 404 })));
    expect(q(".profile__status--error")?.textContent).toBe("That player could not be found.");
  });
});

describe("own profile", () => {
  it("edits and saves the bio, with a counter", async () => {
    const api = apiWith(profileOf({ own: true, bio: "", photoState: ownState }));
    await open(api);
    const area = q<HTMLTextAreaElement>(".profile__bio-input");
    const save = q<HTMLButtonElement>(".profile__save");
    expect(save?.disabled).toBe(true);
    area!.value = "  New bio ";
    area!.dispatchEvent(new Event("input"));
    expect(q(".profile__count")?.textContent).toBe("10/150");
    expect(save?.disabled).toBe(false);
    save!.click();
    await flush();
    expect(api.saveBio).toHaveBeenCalledWith("  New bio ");
    expect(area!.value).toBe("New bio");
    expect(q(".profile__bio-foot .profile__note")?.textContent).toBe(BIO_SAVED);
  });

  it("shows the server's refusal of a bio", async () => {
    const api = apiWith(profileOf({ own: true, bio: "", photoState: ownState }), {
      saveBio: () => Promise.reject(new ApiError("That bio has a word that is not allowed.", { status: 400 })),
    });
    await open(api);
    const area = q<HTMLTextAreaElement>(".profile__bio-input")!;
    area.value = "rude";
    area.dispatchEvent(new Event("input"));
    q<HTMLButtonElement>(".profile__save")!.click();
    await flush();
    expect(q(".profile__note--error")?.textContent).toBe("That bio has a word that is not allowed.");
  });

  it("offers New photo when uploads are allowed, and Remove only with a photo", async () => {
    await open(apiWith(profileOf({ own: true, photoState: ownState })));
    expect(q<HTMLButtonElement>(".profile__new-photo")?.disabled).toBe(false);
    expect(q(".profile__remove-photo")).toBeNull();
    expect(q<HTMLInputElement>(".profile__file")?.accept).toBe("image/*");
  });

  it("removes the photo", async () => {
    const api = apiWith(profileOf({ own: true, photoVersion: 3, photoState: ownState }));
    await open(api);
    q<HTMLButtonElement>(".profile__remove-photo")!.click();
    await flush();
    expect(api.removePhoto).toHaveBeenCalled();
    expect(q(".profile__picture--photo")).toBeNull();
  });

  it("explains why a photo cannot go up", async () => {
    await open(
      apiWith(profileOf({ own: true, photoState: { ...ownState, canUpload: false, reason: "lowLevel" } })),
    );
    expect(q<HTMLButtonElement>(".profile__new-photo")?.disabled).toBe(true);
    expect(q(".profile__photo-row .profile__note")?.textContent).toBe("Photos unlock at level 10.");
  });

  it("words each photo note", () => {
    expect(photoNote(ownState)).toBeNull();
    expect(photoNote({ ...ownState, hidden: true })).toBe(PHOTO_HIDDEN);
    expect(photoNote({ ...ownState, canUpload: false, reason: "blocked" })).toMatch(/off/);
    expect(photoNote({ ...ownState, canUpload: false, reason: "tooSoon", nextAt: "2026-11-08T06:05:00Z" })).toMatch(
      /^Next photo: /,
    );
    expect(photoNote({ ...ownState, canUpload: false, reason: "tooSoon", nextAt: null })).toBe("One photo a day.");
  });

  it("a hidden photo shows the critter and keeps Remove", async () => {
    await open(
      apiWith(
        profileOf({ own: true, photoVersion: null, photoState: { ...ownState, hidden: true, canUpload: false, reason: "underReview" } }),
      ),
    );
    expect(q(".profile__picture--photo")).toBeNull();
    expect(q(".profile__remove-photo")).not.toBeNull();
    expect(q(".profile__photo-row .profile__note")?.textContent).toBe(PHOTO_HIDDEN);
  });
});

describe("cropSquare", () => {
  it("is the whole short side at zoom 1, centred", () => {
    expect(cropSquare(400, 200, 1, 200, 100)).toEqual({ x: 100, y: 0, side: 200 });
  });

  it("shrinks with zoom and stays inside the picture", () => {
    expect(cropSquare(400, 200, 2, 0, 0)).toEqual({ x: 0, y: 0, side: 100 });
    expect(cropSquare(400, 200, 2, 999, 999)).toEqual({ x: 300, y: 100, side: 100 });
  });

  it("keeps zoom between 1 and the most", () => {
    expect(cropSquare(300, 300, 0.2, 150, 150).side).toBe(300);
    expect(cropSquare(300, 300, 99, 150, 150).side).toBe(300 / MAX_ZOOM);
    expect(cropSquare(300, 300, Number.NaN, Number.NaN, 0)).toEqual({ x: 0, y: 0, side: 300 });
  });
});
