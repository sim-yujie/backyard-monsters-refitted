import * as profileApi from "@/api/profile";
import type { Profile } from "@/api/profile";
import { recordOwnProfile } from "@/api/ownPhoto";
import { avatarPath } from "@/game/avatars";
import type { AvatarPicker } from "@/ui/AvatarPicker";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { btn, el, messageOf, NEW_PHOTO, OwnProfileControls, type ProfileApi } from "./OwnProfileControls";
import { LOAD_FAILED, openProfile, pictureFrame } from "./ProfileDialog";
import "./profile.css";

/**
 * The player's own profile in Settings > Account (owner, 13 Nov 2026: "Can
 * 'profile' be merged into 'account' under settings?"), top to bottom:
 *
 * - "Photo", with a small "Preview" (the gold magnifier) that opens the
 *   profile window as other players see it, stats and all;
 * - the photo (or the critter) beside "New photo" and "Remove", and the note
 *   on when the next photo may go up;
 * - the critter picker, headed "No-photo icon": the critter is only the
 *   picture of a player with no photo now;
 * - "Bio", the text box and its Save.
 *
 * The crop step opens in its own small window over Settings, the same one the
 * profile window drew it in, so it fits a phone held either way.
 */

export const OWN_PROFILE_TEXT = {
  photo: "Photo",
  bio: "Bio",
  preview: "Preview",
  previewTitle: "See your profile as other players see it",
} as const;

export interface OwnProfileSectionOptions {
  /** The signed-in player. */
  readonly userid: number;
  /** Where the crop step and the preview open: the overlay's modal layer. */
  readonly container: HTMLElement;
  /** The account menu's critter picker, shown under the photo. */
  readonly avatarPicker?: AvatarPicker;
  readonly api?: ProfileApi;
  /** Opens the preview; by default the profile window, `asOthers`. */
  readonly onPreview?: () => void;
}

export class OwnProfileSection {
  readonly element: HTMLElement;

  private readonly options: OwnProfileSectionOptions;
  private readonly api: ProfileApi;
  private readonly controls: OwnProfileControls;
  /** Where the photo and its buttons go, and the bio box. */
  private readonly photo: HTMLElement;
  private readonly bio: HTMLElement;
  private profile: Profile | null = null;
  /** The crop step's window while it is open. */
  private crop: Popup | null = null;
  private readonly stopPicked: (() => void) | null;

  constructor(options: OwnProfileSectionOptions) {
    this.options = options;
    this.api = options.api ?? profileApi;
    this.controls = new OwnProfileControls({
      api: this.api,
      cameraIcon: true,
      host: { show: (profile) => this.show(profile), showCrop: (step) => this.showCrop(step) },
    });

    this.element = el("section", "account-settings__section own-profile");
    const head = el("div", "own-profile__head");
    head.append(el("h3", "account-settings__heading", OWN_PROFILE_TEXT.photo));
    const preview = btn("btn--ghost own-profile__preview", OWN_PROFILE_TEXT.preview, () => this.preview());
    preview.prepend(gameIcon("find", { size: 24, decorative: true }));
    preview.title = OWN_PROFILE_TEXT.previewTitle;
    preview.setAttribute("aria-label", OWN_PROFILE_TEXT.previewTitle);
    head.append(preview);

    this.photo = el("div", "own-profile__photo");
    this.photo.append(el("p", "profile__status", "Loading…"));
    this.bio = el("div", "own-profile__bio");
    this.bio.hidden = true;
    this.element.append(head, this.photo);
    const picker = options.avatarPicker;
    if (picker) this.element.append(picker.element);
    this.element.append(this.bio);
    // A new critter shows at once on a player with no photo.
    this.stopPicked =
      picker?.onPicked((id) => {
        if (this.profile) this.show({ ...this.profile, pic: avatarPath(id) });
      }) ?? null;
  }

  async load(): Promise<void> {
    try {
      this.show(await this.api.fetchProfile(this.options.userid));
    } catch (caught) {
      this.photo.replaceChildren(el("p", "profile__status profile__status--error", messageOf(caught, LOAD_FAILED)));
    }
  }

  /** Draws `profile`'s photo, buttons and bio; closes the crop step. */
  show(profile: Profile): void {
    this.profile = profile;
    this.crop?.close();
    // The account badge shows the player's own photo; tell it what this one is.
    if (profile.own) recordOwnProfile(profile);
    const { photo, bio } = this.controls.parts(profile);
    this.photo.replaceChildren(pictureFrame(profile), photo);
    const label = el("label", "account-settings__heading own-profile__bio-label", OWN_PROFILE_TEXT.bio);
    const area = bio.querySelector("textarea");
    if (area) {
      area.id = "own-profile-bio";
      label.htmlFor = area.id;
    }
    this.bio.replaceChildren(label, bio);
    this.bio.hidden = false;
  }

  /** Lets go of the picker, for a Settings window closing. */
  destroy(): void {
    this.stopPicked?.();
    this.crop?.close();
  }

  private showCrop(step: HTMLElement): void {
    if (!this.crop) {
      const popup = new Popup({
        title: NEW_PHOTO,
        className: "profile-popup own-profile-crop",
        onClose: () => {
          if (this.crop === popup) this.crop = null;
        },
      });
      this.crop = popup;
      popup.setContent(step).mount(this.options.container);
      return;
    }
    this.crop.setContent(step);
  }

  private preview(): void {
    if (this.options.onPreview) this.options.onPreview();
    else openProfile({ container: this.options.container, userid: this.options.userid, api: this.api, asOthers: true });
  }
}
