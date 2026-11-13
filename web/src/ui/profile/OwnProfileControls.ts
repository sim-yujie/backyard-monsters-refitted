import * as profileApi from "@/api/profile";
import type { OwnPhotoState, Profile } from "@/api/profile";
import { gameIcon } from "@/ui/gameIcon";
import { loadPicture, PhotoCropper } from "./PhotoCropper";

/**
 * The player's own profile controls: the photo buttons ("New photo", which
 * opens the crop step, and "Remove") and the bio box with its Save button.
 *
 * Shared by the profile window (`ProfileDialog.ts`) and Settings > Account
 * (`OwnProfileSection.ts`, owner 13 Nov 2026: the menu's "Profile" item moved
 * there). Each says where the crop step goes and how to draw the profile again
 * through its `ProfileHost`.
 */

export const SAVE_FAILED = "Could not save. Try again.";
export const BIO_SAVED = "Saved";
export const PHOTO_HIDDEN = "Your photo is hidden while it is checked.";
export const NEW_PHOTO = "New photo";

/** The calls the profile makes; tests pass their own. */
export interface ProfileApi {
  readonly fetchProfile: (userid: number) => Promise<Profile>;
  readonly saveBio: (bio: string) => Promise<string>;
  readonly uploadPhoto: (dataUrl: string) => Promise<Profile>;
  readonly removePhoto: () => Promise<Profile>;
  readonly reportPhoto: (userid: number) => Promise<boolean>;
}

/** Where the controls draw: the profile window, or the Account tab. */
export interface ProfileHost {
  /** Draws the own profile again with `profile` (after a new photo, a removal, or Back from the crop). */
  readonly show: (profile: Profile) => void;
  /** Shows the crop step in place of the profile. */
  readonly showCrop: (step: HTMLElement) => void;
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export const btn = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const button = el("button", `btn ${className}`, text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
};

export const messageOf = (caught: unknown, fallback: string): string =>
  caught instanceof Error &&
  caught.message &&
  caught.message.length <= 120 &&
  !/^(Could not reach|Request to )|</.test(caught.message)
    ? caught.message
    : fallback;

/** "Tue 14:05": when the next photo may go up. */
export const nextText = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** The short line under the photo buttons on the player's own profile; null when there is nothing to say. */
export const photoNote = (state: OwnPhotoState): string | null => {
  if (state.hidden) return PHOTO_HIDDEN;
  switch (state.reason) {
    case "lowLevel":
      return `Photos unlock at level ${state.minLevel}.`;
    case "blocked":
      return "Photo uploads are off for your account.";
    case "underReview":
      return PHOTO_HIDDEN;
    case "tooSoon": {
      const when = nextText(state.nextAt);
      return when ? `Next photo: ${when}` : "One photo a day.";
    }
    default:
      return null;
  }
};

export interface OwnProfileControlsOptions {
  readonly api: ProfileApi;
  readonly host: ProfileHost;
  /** "New photo" wears the painted camera (Settings); the window keeps the plain word. */
  readonly cameraIcon?: boolean;
}

export class OwnProfileControls {
  private readonly api: ProfileApi;
  private readonly host: ProfileHost;
  private readonly cameraIcon: boolean;
  private profile: Profile | null = null;
  private busy = false;

  constructor(options: OwnProfileControlsOptions) {
    this.api = options.api;
    this.host = options.host;
    this.cameraIcon = options.cameraIcon ?? false;
  }

  /** The photo row and the bio box for `profile`, which becomes the one the controls save against. */
  parts(profile: Profile): { readonly photo: HTMLElement; readonly bio: HTMLElement } {
    this.profile = profile;
    return { photo: this.photoRow(profile), bio: this.bioEditor(profile) };
  }

  private photoRow(profile: Profile): HTMLElement {
    const state = profile.photoState;
    const row = el("div", "profile__photo-row");
    const buttons = el("div", "profile__photo-buttons");
    const status = el("p", "profile__note");
    status.setAttribute("role", "status");

    const input = el("input", "profile__file");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.crop(file, status);
    });

    const pick = btn("btn--primary profile__new-photo", NEW_PHOTO, () => input.click());
    if (this.cameraIcon) pick.prepend(gameIcon("camera", { size: 24, decorative: true }));
    pick.disabled = state ? !state.canUpload : true;
    buttons.append(pick, input);
    if (profile.photoVersion !== null || state?.hidden) {
      const remove = btn("btn--ghost profile__remove-photo", "Remove", () => void this.remove(status, remove));
      buttons.append(remove);
    }
    row.append(buttons);
    const note = state ? photoNote(state) : null;
    status.textContent = note ?? "";
    status.hidden = !note;
    row.append(status);
    return row;
  }

  private bioEditor(profile: Profile): HTMLElement {
    const box = el("div", "profile__bio-edit");
    const area = el("textarea", "profile__bio-input");
    area.value = profile.bio;
    area.maxLength = profileApi.BIO_MAX;
    area.rows = profileApi.BIO_MAX_LINES;
    area.placeholder = "About you";
    area.setAttribute("aria-label", "Bio");
    const foot = el("div", "profile__bio-foot");
    const count = el("span", "profile__count");
    const status = el("span", "profile__note");
    status.setAttribute("role", "status");
    const save = btn("btn--primary profile__save", "Save", () => void this.saveBio(area, save, status));
    const refresh = (): void => {
      count.textContent = `${area.value.length}/${profileApi.BIO_MAX}`;
      save.disabled = area.value === (this.profile?.bio ?? "");
    };
    area.addEventListener("input", () => {
      status.textContent = "";
      refresh();
    });
    refresh();
    foot.append(count, status, save);
    box.append(area, foot);
    return box;
  }

  private async saveBio(area: HTMLTextAreaElement, save: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.busy || !this.profile) return;
    this.busy = true;
    save.disabled = true;
    status.classList.remove("profile__note--error");
    try {
      const bio = await this.api.saveBio(area.value);
      this.profile = { ...this.profile, bio };
      area.value = bio;
      status.textContent = BIO_SAVED;
    } catch (caught) {
      status.textContent = messageOf(caught, SAVE_FAILED);
      status.classList.add("profile__note--error");
      save.disabled = false;
    } finally {
      this.busy = false;
    }
  }

  private async remove(status: HTMLElement, button: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      const profile = await this.api.removePhoto();
      this.busy = false;
      this.host.show(profile);
    } catch (caught) {
      this.busy = false;
      button.disabled = false;
      status.hidden = false;
      status.textContent = messageOf(caught, SAVE_FAILED);
    }
  }

  /** The crop step, in the host's crop place until Use or Back. */
  private async crop(file: File, status: HTMLElement): Promise<void> {
    let picture: HTMLImageElement;
    try {
      picture = await loadPicture(file);
    } catch (caught) {
      status.hidden = false;
      status.textContent = messageOf(caught, SAVE_FAILED);
      return;
    }
    const profile = this.profile;
    if (!profile) return;
    // The frame's side on screen comes from profile.css, so a phone turned
    // after the photo was picked still fits it.
    const cropper = new PhotoCropper({ picture, frame: 260 });
    const step = el("div", "profile profile--crop");
    step.append(el("p", "profile__crop-hint", "Drag to move. Slide to zoom."), cropper.element);
    const note = el("p", "profile__note profile__note--error");
    note.setAttribute("role", "status");
    note.hidden = true;
    const foot = el("div", "profile__crop-foot");
    const back = btn("btn--outline profile__crop-back", "Back", () => this.host.show(profile));
    const use = btn("btn--primary profile__crop-use", "Use photo", () => {
      const dataUrl = cropper.result();
      if (!dataUrl) {
        note.hidden = false;
        note.textContent = SAVE_FAILED;
        return;
      }
      if (this.busy) return;
      this.busy = true;
      use.disabled = true;
      back.disabled = true;
      void this.api
        .uploadPhoto(dataUrl)
        .then((saved) => {
          this.busy = false;
          this.host.show(saved);
        })
        .catch((caught: unknown) => {
          this.busy = false;
          use.disabled = false;
          back.disabled = false;
          note.hidden = false;
          note.textContent = messageOf(caught, SAVE_FAILED);
        });
    });
    foot.append(back, use);
    step.append(note, foot);
    this.host.showCrop(step);
    use.focus();
  }
}
