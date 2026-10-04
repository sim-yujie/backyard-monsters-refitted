// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOverlay } from "@/ui/overlay";
import type { SceneContext } from "../SceneManager";
import { AwayScene } from "./AwayScene";

/** "You were away too long" (#271): Reconnect reloads the page. */

describe("AwayScene", () => {
  it("says why and reloads on Reconnect", () => {
    const overlay = createOverlay(document.body);
    const halt = vi.fn();
    const reload = vi.fn();
    const scene = new AwayScene("10 minutes", halt, reload);
    scene.enter({ overlay } as unknown as SceneContext);
    expect(halt).toHaveBeenCalledTimes(1);
    expect(overlay.content.textContent).toContain("You were away too long");
    expect(overlay.content.textContent).toContain("after 10 minutes without any input");
    const button = [...overlay.content.querySelectorAll("button")].find(
      (b) => b.textContent === "Reconnect",
    );
    expect(button).toBeDefined();
    button?.click();
    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
    scene.exit();
    expect(overlay.content.querySelector(".away-screen")).toBeNull();
    overlay.destroy();
  });
});
