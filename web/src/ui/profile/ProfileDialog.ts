import * as profileApi from "@/api/profile";
import type { OwnPhotoState, Profile } from "@/api/profile";
import { avatarOf, avatarUrl } from "@/game/avatars";
import { achievementBadge } from "@/ui/achievements/badge";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { loadPicture, PhotoCropper } from "./PhotoCropper";
import "@/ui/achievements/achievements.css";
import "./profile.css";

/**
 * A player's profile (owner, beta 7): their photo (or their critter when
 * there is none, or while it is hidden), name, a short bio and stats worked
 * out by the server, shown as icons with numbers.
 *
 * On the player's own profile the bio is a text box with a Save button, and
 * "New photo" opens the crop step (from level 10, once a day). On someone
 * else's, a photo has a small "Report" button: three players' reports hide it
 * until the game team looks (server `services/profile/profiles.ts`).
 */

export const LOAD_FAILED = "Could not load this profile. Try again in a moment.";
export const SAVE_FAILED = "Could not save. Try again.";
export const NO_BIO = "No bio yet.";
export const BIO_SAVED = "Saved";
export const REPORTED = "Reported";
export const REPORT_ASK = "Report this photo?";
export const PHOTO_HIDDEN = "Your photo is hidden while it is checked.";

/** The calls the window makes; tests pass their own. */
export interface ProfileApi {
  readonly fetchProfile: (userid: number) => Promise<Profile>;
  readonly saveBio: (bio: string) => Promise<string>;
  readonly uploadPhoto: (dataUrl: string) => Promise<Profile>;
  readonly removePhoto: () => Promise<Profile>;
  readonly reportPhoto: (userid: number) => Promise<boolean>;
}

export interface ProfileOptions {
  readonly container: HTMLElement;
  readonly userid: number;
  readonly api?: ProfileApi;
  readonly onClose?: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const btn = (className: string, text: string, onClick: () => void): HTMLButtonElement => {
  const button = el("button", `btn ${className}`, text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
};

const messageOf = (caught: unknown, fallback: string): string =>
  caught instanceof Error &&
  caught.message &&
  caught.message.length <= 120 &&
  !/^(Could not reach|Request to )|</.test(caught.message)
    ? caught.message
    : fallback;

/** "Mar 2026". */
export const joinedText = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

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

/** The big picture: the photo when there is one to show, else the critter. */
export const pictureOf = (profile: Profile): { src: string; photo: boolean } =>
  profile.photoVersion !== null
    ? { src: profileApi.photoUrl(profile.userid, profile.photoVersion), photo: true }
    : { src: avatarUrl(avatarOf(profile.pic, profile.userid)), photo: false };

/** One stat: an icon and a short value, the word in its tooltip. */
const stat = (name: string, art: Element, value: string): HTMLElement => {
  const item = el("li", `profile__stat profile__stat--${name.toLowerCase().replace(/\s+/g, "-")}`);
  item.title = name;
  item.setAttribute("aria-label", `${name}: ${value}`);
  const holder = el("span", "profile__stat-icon");
  holder.setAttribute("aria-hidden", "true");
  holder.append(art);
  item.append(holder, el("span", "profile__stat-value", value));
  return item;
};

/** A stat's painted icon (`gameIcon`), at the 24 px the stat row is laid out for. */
const statIcon = (name: GameIconName): HTMLImageElement => gameIcon(name, { size: 24, decorative: true });

export const statsList = (profile: Profile): HTMLElement => {
  const { stats } = profile;
  const list = el("ul", "profile__stats");
  list.append(stat("Level", statIcon("levelup"), String(stats.level)));
  if (stats.townHall > 0) list.append(stat("Town Hall", statIcon("townhall"), String(stats.townHall)));
  list.append(stat("Empire points", statIcon("empire"), formatAmount(stats.empirePoints)));
  if (stats.achievements) {
    list.append(
      stat("Achievements", achievementBadge(1, "gold", true), `${stats.achievements.earned}/${stats.achievements.total}`),
    );
  }
  list.append(stat("Friends", statIcon("friends"), formatAmount(stats.friends)));
  const joined = joinedText(stats.joined);
  if (joined) list.append(stat("Joined", statIcon("time"), joined));
  if (stats.alliance) list.append(stat("Alliance", statIcon("alliance"), stats.alliance));
  return list;
};

/** The profile window. */
export class ProfileDialog {
  readonly popup: Popup;
  private readonly api: ProfileApi;
  private readonly userid: number;
  private profile: Profile | null = null;
  private busy = false;

  constructor(options: ProfileOptions) {
    this.api = options.api ?? profileApi;
    this.userid = options.userid;
    this.popup = new Popup({
      title: "Profile",
      className: "profile-popup",
      ...(options.onClose && { onClose: options.onClose }),
    });
    this.popup.setContent(el("p", "profile__status", "Loading…")).mount(options.container);
  }

  async load(): Promise<void> {
    try {
      this.show(await this.api.fetchProfile(this.userid));
    } catch (caught) {
      this.popup.setContent(el("p", "profile__status profile__status--error", messageOf(caught, LOAD_FAILED)));
    }
  }

  /** Draws `profile` as the window's content. */
  show(profile: Profile): void {
    this.profile = profile;
    const body = el("div", "profile");
    body.dataset["userid"] = String(profile.userid);

    const top = el("div", "profile__top");
    const picture = pictureOf(profile);
    const frame = el("div", `profile__picture${picture.photo ? " profile__picture--photo" : ""}`);
    const image = el("img", "profile__image");
    image.src = picture.src;
    image.alt = picture.photo ? `${profile.username}'s photo` : "";
    image.decoding = "async";
    image.width = 112;
    image.height = 112;
    if (picture.photo) {
      // A photo that will not load shows the critter instead.
      image.addEventListener(
        "error",
        () => {
          image.src = avatarUrl(avatarOf(profile.pic, profile.userid));
          frame.classList.remove("profile__picture--photo");
        },
        { once: true },
      );
    }
    frame.append(image);

    const who = el("div", "profile__who");
    who.append(el("h3", "profile__name", profile.username));
    who.append(statsList(profile));
    top.append(frame, who);
    body.append(top);

    if (profile.own) body.append(this.ownPhotoRow(profile), this.bioEditor(profile));
    else {
      if (profile.bio) body.append(el("p", "profile__bio", profile.bio));
      else body.append(el("p", "profile__bio profile__bio--empty", NO_BIO));
      if (profile.photoVersion !== null) body.append(this.reportRow(profile));
    }
    this.popup.setContent(body);
  }

  private ownPhotoRow(profile: Profile): HTMLElement {
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

    const pick = btn("btn--primary profile__new-photo", "New photo", () => input.click());
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

  private reportRow(profile: Profile): HTMLElement {
    const row = el("div", "profile__report");
    const done = (): void => {
      const mark = el("span", "profile__reported", REPORTED);
      row.replaceChildren(mark);
    };
    if (profile.reported) {
      done();
      return row;
    }
    const ask = (): void => {
      const words = el("span", "profile__note", REPORT_ASK);
      const status = el("span", "profile__note profile__note--error");
      const yes = btn("btn--primary profile__report-yes", "Report", () => {
        if (this.busy) return;
        this.busy = true;
        yes.disabled = true;
        void this.api
          .reportPhoto(profile.userid)
          .then(done)
          .catch((caught: unknown) => {
            status.textContent = messageOf(caught, SAVE_FAILED);
            yes.disabled = false;
          })
          .finally(() => {
            this.busy = false;
          });
      });
      const no = btn("btn--outline profile__report-no", "Cancel", () => row.replaceChildren(open));
      row.replaceChildren(words, yes, no, status);
      yes.focus();
    };
    const open = btn("btn--ghost profile__report-open", "⚑ Report", ask);
    open.title = "Report inappropriate image";
    open.setAttribute("aria-label", "Report inappropriate image");
    row.append(open);
    return row;
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
      this.show(profile);
    } catch (caught) {
      this.busy = false;
      button.disabled = false;
      status.hidden = false;
      status.textContent = messageOf(caught, SAVE_FAILED);
    }
  }

  /** The crop step, in place of the profile until Use or Back. */
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
    const back = btn("btn--outline profile__crop-back", "Back", () => this.show(profile));
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
          this.show(saved);
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
    this.popup.setContent(step);
    use.focus();
  }
}

/** Opens `userid`'s profile in `container` (the modal layer). */
export const openProfile = (options: ProfileOptions): ProfileDialog => {
  const dialog = new ProfileDialog(options);
  void dialog.load();
  return dialog;
};
