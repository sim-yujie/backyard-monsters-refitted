/**
 * The avatar picker (issue #175): the twelve critters in a grid, the current
 * one marked. Shown in Account settings; it used to fill most of the account
 * menu (owner, 5 Nov 2026). A pick is only marked once `onPick` has stored it;
 * a failed save leaves the old mark and says so.
 */

import { AVATARS, avatarName, avatarUrl, type AvatarId } from "@/game/avatars";

export interface AccountAvatar {
  /** The critter the player is shown as: their pick, or their default. */
  readonly current: AvatarId;
  /** False while `current` is only the default, not something they chose. */
  readonly picked: boolean;
  /** Stores a pick; rejects when the server refused or could not be reached. */
  readonly onPick: (id: AvatarId) => Promise<void>;
}

/** What the picker's heading adds while the player still wears the default. */
export const DEFAULT_NOTE = "Default until you pick one";

/** What the picker says when a pick could not be saved. */
export const PICK_FAILED = "Could not save that avatar. Try again.";

export class AvatarPicker {
  readonly element: HTMLElement;

  private readonly tiles = new Map<AvatarId, HTMLButtonElement>();
  private readonly note: HTMLElement;
  private readonly status: HTMLElement;
  private readonly avatar: AccountAvatar;
  private current: AvatarId;
  private saving = false;

  constructor(avatar: AccountAvatar) {
    this.avatar = avatar;
    this.current = avatar.current;

    this.element = document.createElement("div");
    this.element.className = "avatar-picker";

    const heading = document.createElement("div");
    heading.className = "avatar-picker__head";
    heading.id = "avatar-picker-head";
    const title = document.createElement("h3");
    title.className = "account-settings__heading";
    title.textContent = "Avatar";
    this.note = document.createElement("span");
    this.note.className = "avatar-picker__note";
    this.note.textContent = DEFAULT_NOTE;
    this.note.hidden = avatar.picked;
    heading.append(title, this.note);

    const grid = document.createElement("div");
    grid.className = "avatar-picker__grid";
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-labelledby", heading.id);
    for (const { id } of AVATARS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "avatar-picker__tile";
      tile.dataset["avatar"] = id;
      tile.setAttribute("role", "radio");
      tile.setAttribute("aria-label", avatarName(id));
      tile.title = avatarName(id);
      const picture = document.createElement("img");
      picture.src = avatarUrl(id);
      picture.alt = "";
      picture.decoding = "async";
      picture.loading = "lazy";
      tile.append(picture);
      tile.addEventListener("click", () => void this.pick(id));
      grid.append(tile);
      this.tiles.set(id, tile);
    }

    this.status = document.createElement("p");
    this.status.className = "avatar-picker__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.element.append(heading, grid, this.status);
    this.mark();
  }

  private mark(): void {
    for (const [id, tile] of this.tiles) {
      const on = id === this.current;
      tile.setAttribute("aria-checked", String(on));
      tile.classList.toggle("is-current", on);
    }
  }

  private async pick(id: AvatarId): Promise<void> {
    if (this.saving) return;
    if (id === this.current && this.note.hidden) return;
    this.saving = true;
    for (const tile of this.tiles.values()) tile.disabled = true;
    this.status.hidden = true;
    try {
      await this.avatar.onPick(id);
      this.current = id;
      this.note.hidden = true;
      this.mark();
    } catch {
      this.status.textContent = PICK_FAILED;
      this.status.hidden = false;
    } finally {
      this.saving = false;
      for (const tile of this.tiles.values()) tile.disabled = false;
    }
  }
}
