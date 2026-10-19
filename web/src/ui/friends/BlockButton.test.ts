// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/privacy", () => ({ blockPlayer: vi.fn() }));

import { BLOCK_TEXT, blockButton } from "./BlockButton";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const pressed = (root: HTMLElement, selector: string) => root.querySelector<HTMLButtonElement>(selector)!.click();

afterEach(() => document.body.replaceChildren());

describe("blockButton", () => {
  it("asks first and does not block until confirmed", () => {
    const block = vi.fn().mockResolvedValue(undefined);
    const root = blockButton({ userid: 4, username: "Dee", block });
    document.body.append(root);
    expect(root.querySelector<HTMLElement>(".block-button__confirm")!.hidden).toBe(true);
    pressed(root, ".block-button__ask");
    expect(root.querySelector<HTMLElement>(".block-button__confirm")!.hidden).toBe(false);
    expect(root.textContent).toContain(BLOCK_TEXT.question("Dee"));
    expect(block).not.toHaveBeenCalled();
  });

  it("Cancel goes back without blocking", () => {
    const block = vi.fn();
    const root = blockButton({ userid: 4, username: "Dee", block });
    pressed(root, ".block-button__ask");
    pressed(root, ".block-button__no");
    expect(root.querySelector<HTMLElement>(".block-button__ask")!.hidden).toBe(false);
    expect(block).not.toHaveBeenCalled();
  });

  it("blocks on the second press and tells the row", async () => {
    const block = vi.fn().mockResolvedValue(undefined);
    const onBlocked = vi.fn();
    const root = blockButton({ userid: 4, username: "Dee", block, onBlocked });
    pressed(root, ".block-button__ask");
    pressed(root, ".block-button__yes");
    await settle();
    expect(block).toHaveBeenCalledWith(4);
    expect(onBlocked).toHaveBeenCalledWith(4);
    expect(root.textContent).toBe(BLOCK_TEXT.done("Dee"));
  });

  it("reports a failure and lets the player try again", async () => {
    const block = vi.fn().mockRejectedValue(new Error("down"));
    const onError = vi.fn();
    const onBlocked = vi.fn();
    const root = blockButton({ userid: 4, username: "Dee", block, onError, onBlocked });
    pressed(root, ".block-button__ask");
    pressed(root, ".block-button__yes");
    await settle();
    expect(onError).toHaveBeenCalledOnce();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLButtonElement>(".block-button__yes")!.disabled).toBe(false);
  });
});
