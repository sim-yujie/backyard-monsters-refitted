// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { yardSnapshotPanel, type PictureClipboard, type YardSnapshotPanelOptions } from "./YardSnapshotPanel";

/** The yard picture's window (owner, 2026-11-11): the picture, Save and Copy. */

const PNG = new Blob(["png"], { type: "image/png" });

const open = (over: Partial<YardSnapshotPanelOptions> = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  const options: YardSnapshotPanelOptions = {
    picture: Promise.resolve(PNG),
    fileName: "bymr-yard-kevin-2026-11-11.png",
    onClose: vi.fn(),
    clipboard: { write: vi.fn(() => Promise.resolve()) },
    urlFor: vi.fn(() => "blob:yard"),
    revoke: vi.fn(),
    ...over,
  };
  const panel = yardSnapshotPanel(options).mount(container);
  const $ = <T extends HTMLElement>(selector: string): T | null => panel.element.querySelector<T>(selector);
  const buttonNamed = (name: string): HTMLButtonElement =>
    [...panel.element.querySelectorAll<HTMLButtonElement>(".planner-snapshot__actions button")].find(
      (button) => button.textContent === name,
    )!;
  return { panel, options, $, buttonNamed };
};

/** Lets the picture's promise and what hangs off it run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("yardSnapshotPanel", () => {
  it("shows the picture once it is made, says the traps are hidden, and only then lets it be saved", async () => {
    const { $, buttonNamed } = open();
    expect($(".planner-snapshot__frame")!.getAttribute("aria-busy")).toBe("true");
    expect(buttonNamed("Save").disabled).toBe(true);
    await settle();
    expect($<HTMLImageElement>(".planner-snapshot__image")!.src).toBe("blob:yard");
    expect($(".planner-snapshot__note")!.textContent).toBe("Traps hidden");
    expect(buttonNamed("Save").disabled).toBe(false);
    expect(buttonNamed("Copy").disabled).toBe(false);
  });

  it("saves the picture as a file under its name", async () => {
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    const { buttonNamed } = open();
    await settle();
    buttonNamed("Save").click();
    expect(clicked).toEqual([{ href: "blob:yard", download: "bymr-yard-kevin-2026-11-11.png" }]);
  });

  it("copies the picture and says so, then reads Copy again", async () => {
    vi.useFakeTimers();
    const write = vi.fn<PictureClipboard["write"]>(() => Promise.resolve());
    const { options, buttonNamed } = open({ clipboard: { write } });
    await settle();
    buttonNamed("Copy").click();
    expect(write).toHaveBeenCalledWith(options.picture);
    await settle();
    const copy = [...document.querySelectorAll<HTMLButtonElement>(".planner-snapshot__actions button")][0]!;
    expect(copy.textContent).toBe("Copied");
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.textContent).toBe("Copy");
  });

  it("says when the browser would not copy", async () => {
    const { buttonNamed } = open({ clipboard: { write: () => Promise.reject(new Error("denied")) } });
    await settle();
    const copy = buttonNamed("Copy");
    copy.click();
    await settle();
    expect(copy.textContent).toBe("Copy failed");
  });

  it("offers no Copy where the browser cannot copy a picture", async () => {
    const { panel } = open({ clipboard: null });
    await settle();
    const copy = [...panel.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Copy");
    expect(copy?.hidden).toBe(true);
  });

  it("says so when the picture could not be drawn or made", async () => {
    for (const picture of [null, Promise.reject(new Error("no 2D canvas"))]) {
      const { $ } = open({ picture });
      await settle();
      expect($(".planner-snapshot__frame")!.textContent).toBe("Couldn't take the picture. Try again.");
      expect($(".planner-snapshot__actions")!.hidden).toBe(true);
      document.body.replaceChildren();
    }
  });

  it("lets the picture's address go when it closes", async () => {
    const { panel, options } = open();
    await settle();
    panel.close();
    expect(options.revoke).toHaveBeenCalledWith("blob:yard");
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });

  it("makes no address for a picture that arrives after the window closed", async () => {
    let resolve: (blob: Blob) => void = () => {};
    const { panel, options } = open({ picture: new Promise<Blob>((done) => (resolve = done)) });
    panel.close();
    resolve(PNG);
    await settle();
    expect(options.urlFor).not.toHaveBeenCalled();
  });
});
