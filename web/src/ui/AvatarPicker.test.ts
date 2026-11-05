// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarId } from "@/game/avatars";
import { AvatarPicker, DEFAULT_NOTE, PICK_FAILED } from "./AvatarPicker";

const withAvatar = (
  current: AvatarId,
  picked: boolean,
  onPick: (id: AvatarId) => Promise<void> = () => Promise.resolve(),
) => {
  const pick = vi.fn(onPick);
  const created = new AvatarPicker({ current, picked, onPick: pick });
  document.body.append(created.element);
  const tile = (id: AvatarId) =>
    created.element.querySelector<HTMLButtonElement>(`.avatar-picker__tile[data-avatar="${id}"]`)!;
  const checked = () =>
    [...created.element.querySelectorAll<HTMLElement>('.avatar-picker__tile[aria-checked="true"]')].map(
      (node) => node.dataset["avatar"],
    );
  const note = () => created.element.querySelector<HTMLElement>(".avatar-picker__note")!;
  const status = () => created.element.querySelector<HTMLElement>(".avatar-picker__status")!;
  return { element: created.element, pick, tile, checked, note, status };
};

afterEach(() => document.body.replaceChildren());

describe("AvatarPicker", () => {
  it("shows all twelve critters with the current one marked", () => {
    const { element, checked, note } = withAvatar("owl", true);
    expect(element.querySelectorAll(".avatar-picker__tile")).toHaveLength(12);
    expect(checked()).toEqual(["owl"]);
    expect(note().hidden).toBe(true);
  });

  it("says when the marked critter is only the default", () => {
    const { checked, note } = withAvatar("frog", false);
    expect(checked()).toEqual(["frog"]);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe(DEFAULT_NOTE);
  });

  it("stores a pick, then moves the mark to it", async () => {
    const { pick, tile, checked, note } = withAvatar("frog", false);
    tile("bee").click();
    expect(pick).toHaveBeenCalledWith("bee");
    await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
    expect(note().hidden).toBe(true);
  });

  it("keeps the old mark and says so when the save fails", async () => {
    const { pick, tile, checked, status } = withAvatar("owl", true, () => Promise.reject(new Error("no")));
    tile("mole").click();
    expect(pick).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(status().hidden).toBe(false));
    expect(status().textContent).toBe(PICK_FAILED);
    expect(checked()).toEqual(["owl"]);
    expect(tile("mole").disabled).toBe(false);
  });

  it("does not re-send the avatar already picked, but lets a default be confirmed", async () => {
    const picked = withAvatar("owl", true);
    picked.tile("owl").click();
    expect(picked.pick).not.toHaveBeenCalled();
    document.body.replaceChildren();

    const fallback = withAvatar("owl", false);
    fallback.tile("owl").click();
    expect(fallback.pick).toHaveBeenCalledWith("owl");
    await vi.waitFor(() => expect(fallback.note().hidden).toBe(true));
  });

  it("sends one pick at a time", async () => {
    let finish: () => void = () => {};
    const { pick, tile, checked } = withAvatar("owl", true, () => new Promise<void>((done) => (finish = done)));
    tile("bee").click();
    tile("worm").click();
    expect(pick).toHaveBeenCalledOnce();
    expect(tile("worm").disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
  });
});
