// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/api/profile";
import { resetOwnPhoto, watchOwnPhoto } from "@/api/ownPhoto";
import { AvatarPicker, PICKER_TITLE } from "@/ui/AvatarPicker";

vi.mock("./PhotoCropper", () => ({
  loadPicture: vi.fn(() => Promise.resolve(document.createElement("img"))),
  PhotoCropper: class {
    readonly element = Object.assign(document.createElement("div"), { className: "photo-crop" });
    result(): string {
      return "data:image/jpeg;base64,AAAA";
    }
  },
}));

import { NO_BIO, openProfile } from "./ProfileDialog";
import { BIO_SAVED, NEW_PHOTO, PHOTO_HIDDEN, type ProfileApi } from "./OwnProfileControls";
import { OWN_PROFILE_TEXT, OwnProfileSection } from "./OwnProfileSection";

/**
 * The player's own profile in Settings > Account (owner, 13 Nov 2026): the
 * photo with New photo / Remove, the critter picker as the no-photo icon, the
 * bio, and Preview, which shows the profile as other players see it.
 */

const ownState = {
  hidden: false,
  blocked: false,
  canUpload: true,
  reason: null,
  nextAt: null,
  minLevel: 10,
} as const;

const profileOf = (extra: Partial<Profile> = {}): Profile => ({
  userid: 2503,
  username: "yardtester",
  pic: "/avatars/owl.webp",
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
  own: true,
  reported: false,
  photoState: ownState,
  ...extra,
});

const apiWith = (profile: Profile | Error, extra: Partial<ProfileApi> = {}): ProfileApi => ({
  fetchProfile: vi.fn(() => (profile instanceof Error ? Promise.reject(profile) : Promise.resolve(profile))),
  saveBio: vi.fn((bio: string) => Promise.resolve(bio.trim())),
  uploadPhoto: vi.fn(() => Promise.resolve(profileOf({ photoVersion: 4 }))),
  removePhoto: vi.fn(() => Promise.resolve(profileOf())),
  reportPhoto: vi.fn(() => Promise.resolve(false)),
  ...extra,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let container: HTMLElement;

const build = async (api: ProfileApi, extra: { picker?: AvatarPicker; onPreview?: () => void } = {}) => {
  const section = new OwnProfileSection({
    userid: 2503,
    container,
    api,
    ...(extra.picker && { avatarPicker: extra.picker }),
    ...(extra.onPreview && { onPreview: extra.onPreview }),
  });
  container.append(section.element);
  await section.load();
  return section;
};

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  document.body.replaceChildren();
  resetOwnPhoto();
  vi.clearAllMocks();
});

describe("OwnProfileSection", () => {
  it("shows Photo and Preview, the picture beside New photo, the picker, then the bio", async () => {
    const picker = new AvatarPicker({ current: "owl", picked: true, onPick: () => Promise.resolve() });
    const section = await build(apiWith(profileOf()), { picker });
    const parts = [...section.element.children].map((child) => child.className);
    expect(parts).toEqual(["own-profile__head", "own-profile__photo", "avatar-picker", "own-profile__bio"]);
    const head = q(".own-profile__head", section.element)!;
    expect(head.querySelector("h3")?.textContent).toBe(OWN_PROFILE_TEXT.photo);
    const preview = head.querySelector<HTMLButtonElement>(".own-profile__preview")!;
    expect(preview.textContent).toBe(OWN_PROFILE_TEXT.preview);
    expect(preview.querySelector(".game-icon")).not.toBeNull();
    // The critter, since there is no photo.
    expect(q<HTMLImageElement>(".profile__image", section.element)?.getAttribute("src")).toMatch(/avatars\/owl\.webp$/);
    const pick = q<HTMLButtonElement>(".profile__new-photo", section.element)!;
    expect(pick.textContent).toBe(NEW_PHOTO);
    expect(pick.querySelector(".game-icon")).not.toBeNull();
    expect(pick.disabled).toBe(false);
    // No photo, so nothing to remove.
    expect(q(".profile__remove-photo", section.element)).toBeNull();
    // The picker says what the critter is for now.
    expect(q(".avatar-picker h3", section.element)?.textContent).toBe(PICKER_TITLE);
    const label = q<HTMLLabelElement>(".own-profile__bio label", section.element)!;
    expect(label.textContent).toBe(OWN_PROFILE_TEXT.bio);
    const area = q<HTMLTextAreaElement>(".profile__bio-input", section.element)!;
    expect(label.htmlFor).toBe(area.id);
    expect(area.value).toBe("Hello there");
  });

  it("shows the photo with Remove when there is one, and the critter again after Remove", async () => {
    const api = apiWith(profileOf({ photoVersion: 3 }));
    const section = await build(api);
    expect(q(".profile__picture--photo", section.element)).not.toBeNull();
    q<HTMLButtonElement>(".profile__remove-photo", section.element)!.click();
    await flush();
    expect(api.removePhoto).toHaveBeenCalledOnce();
    expect(q(".profile__picture--photo", section.element)).toBeNull();
    expect(q(".profile__remove-photo", section.element)).toBeNull();
  });

  it("tells the account badge about the photo it shows", async () => {
    const seen: (string | null)[] = [];
    watchOwnPhoto(2503, (url) => seen.push(url));
    await build(apiWith(profileOf({ photoVersion: 3 })));
    expect(seen.at(-1)).toMatch(/photos\/2503\?v=3$/);
  });

  it("says why a photo cannot go up, with New photo greyed", async () => {
    const section = await build(apiWith(profileOf({ photoState: { ...ownState, hidden: true, canUpload: false } })));
    expect(q<HTMLButtonElement>(".profile__new-photo", section.element)!.disabled).toBe(true);
    expect(q(".profile__note", section.element)?.textContent).toBe(PHOTO_HIDDEN);
  });

  it("saves the bio", async () => {
    const api = apiWith(profileOf());
    const section = await build(api);
    const area = q<HTMLTextAreaElement>(".profile__bio-input", section.element)!;
    const save = q<HTMLButtonElement>(".profile__save", section.element)!;
    expect(save.disabled).toBe(true);
    area.value = "New words ";
    area.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    expect(api.saveBio).toHaveBeenCalledWith("New words ");
    expect(area.value).toBe("New words");
    expect(q(".profile__bio-foot", section.element)?.textContent).toContain(BIO_SAVED);
  });

  it("shows the new critter at once when the player has no photo", async () => {
    const picker = new AvatarPicker({ current: "owl", picked: true, onPick: () => Promise.resolve() });
    const section = await build(apiWith(profileOf()), { picker });
    q<HTMLButtonElement>('.avatar-picker__tile[data-avatar="bee"]', section.element)!.click();
    await vi.waitFor(() =>
      expect(q<HTMLImageElement>(".profile__image", section.element)?.getAttribute("src")).toMatch(/avatars\/bee\.webp$/),
    );
  });

  it("keeps the photo when the critter changes, and lets go of the picker on destroy", async () => {
    const picker = new AvatarPicker({ current: "owl", picked: true, onPick: () => Promise.resolve() });
    const section = await build(apiWith(profileOf({ photoVersion: 3 })), { picker });
    q<HTMLButtonElement>('.avatar-picker__tile[data-avatar="bee"]', section.element)!.click();
    await flush();
    expect(q<HTMLImageElement>(".profile__image", section.element)?.getAttribute("src")).toMatch(/photos\/2503\?v=3$/);
    section.destroy();
    const before = q<HTMLImageElement>(".profile__image", section.element);
    q<HTMLButtonElement>('.avatar-picker__tile[data-avatar="owl"]', section.element)!.click();
    await flush();
    expect(q<HTMLImageElement>(".profile__image", section.element)).toBe(before);
  });

  it("says so when the profile will not load, and keeps the picker", async () => {
    const picker = new AvatarPicker({ current: "owl", picked: true, onPick: () => Promise.resolve() });
    const section = await build(apiWith(new Error("Could not reach the server")), { picker });
    expect(q(".profile__status--error", section.element)).not.toBeNull();
    expect(section.element.querySelectorAll(".avatar-picker__tile")).toHaveLength(12);
    expect(q<HTMLElement>(".own-profile__bio", section.element)!.hidden).toBe(true);
  });

  it("opens the crop step in its own window; Back closes it, Use photo saves and redraws", async () => {
    const api = apiWith(profileOf());
    const section = await build(api);
    const input = q<HTMLInputElement>(".profile__file", section.element)!;
    const choose = async () => {
      Object.defineProperty(input, "files", { value: [new File(["x"], "me.png", { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change"));
      await flush();
    };
    await choose();
    const crop = () => document.querySelector<HTMLElement>(".own-profile-crop");
    expect(crop()).not.toBeNull();
    expect(crop()!.querySelector(".panel__title, h2")?.textContent).toContain(NEW_PHOTO);
    // Settings' section stays as it was under the crop window.
    expect(q(".own-profile__photo .profile__new-photo", section.element)).not.toBeNull();
    crop()!.querySelector<HTMLButtonElement>(".profile__crop-back")!.click();
    expect(crop()).toBeNull();

    await choose();
    crop()!.querySelector<HTMLButtonElement>(".profile__crop-use")!.click();
    await flush();
    expect(api.uploadPhoto).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA");
    expect(crop()).toBeNull();
    expect(q(".profile__picture--photo", section.element)).not.toBeNull();
  });

  it("Preview calls its handler", async () => {
    const onPreview = vi.fn();
    const section = await build(apiWith(profileOf()), { onPreview });
    q<HTMLButtonElement>(".own-profile__preview", section.element)!.click();
    expect(onPreview).toHaveBeenCalledOnce();
  });
});

describe("the profile window as others see it (Preview)", () => {
  it("draws the player's own profile with no editor and no Report", async () => {
    const api = apiWith(profileOf({ photoVersion: 3 }));
    openProfile({ container, userid: 2503, api, asOthers: true });
    await flush();
    expect(q(".profile__stats")).not.toBeNull();
    expect(q(".profile__bio")?.textContent).toBe("Hello there");
    expect(q(".profile__bio-input")).toBeNull();
    expect(q(".profile__new-photo")).toBeNull();
    expect(q(".profile__report")).toBeNull();
    expect(q(".profile__picture--photo")).not.toBeNull();
  });

  it("says No bio yet when the player has none", async () => {
    openProfile({ container, userid: 2503, api: apiWith(profileOf({ bio: "" })), asOthers: true });
    await flush();
    expect(q(".profile__bio--empty")?.textContent).toBe(NO_BIO);
  });

  it("still opens the editor on the player's own profile without asOthers", async () => {
    openProfile({ container, userid: 2503, api: apiWith(profileOf()) });
    await flush();
    expect(q(".profile__bio-input")).not.toBeNull();
  });

  it("opens from the section's Preview by default", async () => {
    const api = apiWith(profileOf());
    const section = await build(api);
    q<HTMLButtonElement>(".own-profile__preview", section.element)!.click();
    await flush();
    const window = document.querySelector<HTMLElement>(".profile-popup:not(.own-profile-crop)")!;
    expect(window).not.toBeNull();
    expect(window.querySelector(".profile__stats")).not.toBeNull();
    expect(window.querySelector(".profile__bio-input")).toBeNull();
  });
});
