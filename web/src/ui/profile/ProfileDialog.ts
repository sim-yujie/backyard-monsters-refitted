import * as profileApi from "@/api/profile";
import type { Profile } from "@/api/profile";
import { recordOwnProfile } from "@/api/ownPhoto";
import { playerPicture, type PlayerPicture } from "@/game/playerPicture";
import { achievementBadge } from "@/ui/achievements/badge";
import { formatAmount } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import {
  btn,
  el,
  messageOf,
  OwnProfileControls,
  SAVE_FAILED,
  type ProfileApi,
} from "./OwnProfileControls";
import { friendMarkOf } from "@/game/friends/friendMarks";
import { friendBadge } from "@/ui/friends/friendBadge";
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
 *
 * The account menu no longer has a "Profile" item (owner, 13 Nov 2026): the
 * player edits their own in Settings > Account (`OwnProfileSection.ts`), whose
 * "Preview" opens this window `asOthers`, showing their profile the way other
 * players see it. Their own name tapped elsewhere still opens the editor here.
 */

export const LOAD_FAILED = "Could not load this profile. Try again in a moment.";
export const NO_BIO = "No bio yet.";
export const REPORTED = "Reported";
export const REPORT_ASK = "Report this photo?";
export { BIO_SAVED, PHOTO_HIDDEN, SAVE_FAILED, nextText, photoNote, type ProfileApi } from "./OwnProfileControls";

export interface ProfileOptions {
  readonly container: HTMLElement;
  readonly userid: number;
  readonly api?: ProfileApi;
  readonly onClose?: () => void;
  /** The player's own profile drawn as other players see it: no editor (Settings' "Preview"). */
  readonly asOthers?: boolean;
}

/** "Mar 2026". */
export const joinedText = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

/** The big picture: the photo when there is one to show, else the critter. */
export const pictureOf = (profile: Profile): PlayerPicture =>
  playerPicture(profile.userid, profile.pic, profile.photoVersion);

/**
 * The photo (or critter) in its frame, 112 px; CSS may draw it smaller. A
 * photo that will not load shows the critter instead.
 */
export const pictureFrame = (profile: Profile): HTMLElement => {
  const picture = pictureOf(profile);
  const frame = el("div", `profile__picture${picture.photo ? " profile__picture--photo" : ""}`);
  const image = el("img", "profile__image");
  image.src = picture.src;
  image.alt = picture.photo ? `${profile.username}'s photo` : "";
  image.decoding = "async";
  image.width = 112;
  image.height = 112;
  if (picture.photo) {
    image.addEventListener(
      "error",
      () => {
        image.src = picture.critter;
        frame.classList.remove("profile__picture--photo");
      },
      { once: true },
    );
  }
  frame.append(image);
  return frame;
};

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
  private readonly asOthers: boolean;
  /** The photo buttons and bio box on the player's own profile. */
  private readonly own: OwnProfileControls;
  /** A report on its way: one at a time. */
  private busy = false;

  constructor(options: ProfileOptions) {
    this.api = options.api ?? profileApi;
    this.userid = options.userid;
    this.asOthers = options.asOthers ?? false;
    this.own = new OwnProfileControls({
      api: this.api,
      host: { show: (profile) => this.show(profile), showCrop: (step) => this.popup.setContent(step) },
    });
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
    // The account badge shows the player's own photo; tell it what this one is.
    if (profile.own) recordOwnProfile(profile);
    const body = el("div", "profile");
    body.dataset["userid"] = String(profile.userid);

    const top = el("div", "profile__top");
    const frame = pictureFrame(profile);

    const who = el("div", "profile__who");
    const name = el("h3", "profile__name", profile.username);
    // A friend's profile wears the friend marker before the name (beta 7).
    const badge = profile.own ? null : friendBadge(friendMarkOf(profile.userid), 24, "profile__friend");
    if (badge) name.prepend(badge, " ");
    who.append(name);
    who.append(statsList(profile));
    top.append(frame, who);
    body.append(top);

    if (profile.own && !this.asOthers) {
      const { photo, bio } = this.own.parts(profile);
      body.append(photo, bio);
    } else {
      if (profile.bio) body.append(el("p", "profile__bio", profile.bio));
      else body.append(el("p", "profile__bio profile__bio--empty", NO_BIO));
      // Nobody reports their own photo, even in the preview.
      if (!profile.own && profile.photoVersion !== null) body.append(this.reportRow(profile));
    }
    this.popup.setContent(body);
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
      // The question sits on its own line above the two plates, and a failed
      // report shows its message in that same line, so the row keeps one
      // height (see .profile__report) and the plates never wrap.
      const words = el("span", "profile__note profile__report-ask", REPORT_ASK);
      const yes = btn("btn--primary profile__report-yes", "Report", () => {
        if (this.busy) return;
        this.busy = true;
        yes.disabled = true;
        words.textContent = REPORT_ASK;
        words.classList.remove("profile__note--error");
        void this.api
          .reportPhoto(profile.userid)
          .then(done)
          .catch((caught: unknown) => {
            words.textContent = messageOf(caught, SAVE_FAILED);
            words.title = words.textContent; // a long message ends in "…" on one line
            words.classList.add("profile__note--error");
            yes.disabled = false;
          })
          .finally(() => {
            this.busy = false;
          });
      });
      const no = btn("btn--outline profile__report-no", "Cancel", () => row.replaceChildren(open));
      row.replaceChildren(words, yes, no);
      yes.focus();
    };
    const open = btn("btn--ghost profile__report-open", "⚑ Report", ask);
    open.title = "Report inappropriate image";
    open.setAttribute("aria-label", "Report inappropriate image");
    row.append(open);
    return row;
  }
}

/** Opens `userid`'s profile in `container` (the modal layer). */
export const openProfile = (options: ProfileOptions): ProfileDialog => {
  const dialog = new ProfileDialog(options);
  void dialog.load();
  return dialog;
};
