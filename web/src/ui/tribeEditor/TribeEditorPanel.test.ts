// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { TribeEdit } from "@/game/tribeEditor/tribeEditSession";
import { TribeYardSim } from "@/game/tribeEditor/tribeYardSim";
import { TribeEditBar } from "./TribeEditorPanel";

const edit = (): TribeEdit => ({
  tribe: "abunaki",
  name: "Abunakki",
  level: 31,
  from: 31,
  saved: false,
  sim: new TribeYardSim({
    baseid: "0",
    buildingdata: { "1": { X: 0, Y: 0, t: 14, id: 1, l: 4 } },
    monsters: {},
    academy: {},
    lockerdata: {},
  } as unknown as BaseLoadResponse),
});

const bar = (onReset: () => Promise<string>, onSave: () => Promise<string> = async () => "saved") => {
  const host = document.createElement("div");
  document.body.append(host);
  return new TribeEditBar({ edit: edit(), onChanged: () => {}, onSave, onReset, onPick: () => {}, onExit: () => {} }).mount(
    host,
  );
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TribeEditBar", () => {
  afterEach(() => document.body.replaceChildren());

  it("names the tribe and level on the save button", () => {
    expect(bar(async () => "").saveButton.textContent).toBe("Save as Abunakki level 31");
  });

  it("resets attacked camps only on the second click and shows the answer", async () => {
    const onReset = vi.fn(async () => "Reset 2 attacked camps: they use the saved yard now.");
    const shown = bar(onReset);
    shown.resetButton.click();
    await flush();
    expect(onReset).not.toHaveBeenCalled();
    expect(shown.resetButton.textContent).toBe("Click again to reset");

    shown.resetButton.click();
    await flush();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(shown.resetButton.textContent).toBe(TribeEditBar.RESET_LABEL);
    expect(document.body.textContent).toContain("Reset 2 attacked camps");
  });

  it("says when a reset fails", async () => {
    const shown = bar(async () => {
      throw new Error("Not found");
    });
    shown.resetButton.click();
    shown.resetButton.click();
    await flush();
    expect(document.body.textContent).toContain("Not reset: Not found");
    expect(shown.resetButton.disabled).toBe(false);
  });
});
