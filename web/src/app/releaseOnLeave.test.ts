import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTextures } from "pixi.js";
import { type Closable, type LeavePage, PictureList, notePictureLoads, releaseOnLeave } from "./releaseOnLeave";

/** Patch 7.12: the decoded pictures are closed when the page is left for good. */

class FakePicture implements Closable {
  width = 64;
  closes = 0;
  constructor(private readonly onClose: () => void = () => undefined) {}
  close(): void {
    this.closes += 1;
    this.width = 0;
    this.onClose();
  }
}

const isFake = (value: unknown): value is Closable => value instanceof FakePicture;

interface FakePage extends LeavePage {
  readonly window: EventTarget;
  readonly document: EventTarget & { visibilityState: DocumentVisibilityState };
  reloads: number;
}

const fakePage = (): FakePage => {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const page: FakePage = {
    window: new EventTarget(),
    document: doc,
    reloads: 0,
    reload: () => {
      page.reloads += 1;
    },
  };
  return page;
};

const pageHide = (page: FakePage, persisted: boolean): void => {
  page.window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted }));
};
const hide = (page: FakePage): void => {
  page.document.visibilityState = "hidden";
  page.document.dispatchEvent(new Event("visibilitychange"));
};
const unload = (page: FakePage): void => {
  page.window.dispatchEvent(new Event("unload"));
};

const listOf = (...pictures: FakePicture[]): PictureList => {
  const list = new PictureList();
  for (const picture of pictures) list.note(picture, isFake);
  return list;
};

describe("releaseOnLeave", () => {
  it("closes every picture once the page is left for good and turns hidden", () => {
    const page = fakePage();
    const pictures = [new FakePicture(), new FakePicture(), new FakePicture()];
    releaseOnLeave({ pictures: listOf(...pictures), page });

    pageHide(page, false);
    expect(pictures.map((p) => p.closes)).toEqual([0, 0, 0]);
    hide(page);
    expect(pictures.map((p) => p.closes)).toEqual([1, 1, 1]);
  });

  it("closes on unload when the page does not turn hidden first (Safari, Firefox)", () => {
    const page = fakePage();
    const picture = new FakePicture();
    releaseOnLeave({ pictures: listOf(picture), page });

    pageHide(page, false);
    unload(page);
    expect(picture.closes).toBe(1);
  });

  it("keeps the pictures of a page kept for Back/Forward (persisted)", () => {
    const page = fakePage();
    const picture = new FakePicture();
    releaseOnLeave({ pictures: listOf(picture), page });

    pageHide(page, true);
    hide(page);
    unload(page);
    expect(picture.closes).toBe(0);
  });

  it("does nothing when the page is only hidden, not left (another app, a locked phone)", () => {
    const page = fakePage();
    const picture = new FakePicture();
    releaseOnLeave({ pictures: listOf(picture), page });

    hide(page);
    expect(picture.closes).toBe(0);
  });

  it("runs after every pagehide listener, even one added later (the attack's keepalive save)", () => {
    const page = fakePage();
    const order: string[] = [];
    const picture = new FakePicture(() => order.push("closed"));
    releaseOnLeave({ pictures: listOf(picture), page });
    page.window.addEventListener("pagehide", () => order.push("attack save"));
    page.document.addEventListener("visibilitychange", () => order.push("checkpoint"));

    pageHide(page, false);
    hide(page);
    unload(page);
    expect(order).toEqual(["attack save", "checkpoint", "closed"]);
  });

  it("stops drawing before closing", () => {
    const page = fakePage();
    const order: string[] = [];
    const picture = new FakePicture(() => order.push("closed"));
    releaseOnLeave({ pictures: listOf(picture), page, stopDrawing: () => order.push("stopped") });

    pageHide(page, false);
    hide(page);
    expect(order).toEqual(["stopped", "closed"]);
  });

  it("is idempotent: a second leave event or a second pagehide closes nothing again", () => {
    const page = fakePage();
    const picture = new FakePicture();
    const stopDrawing = vi.fn();
    releaseOnLeave({ pictures: listOf(picture), page, stopDrawing });

    pageHide(page, false);
    hide(page);
    unload(page);
    pageHide(page, false);
    hide(page);
    expect(picture.closes).toBe(1);
    expect(stopDrawing).toHaveBeenCalledTimes(1);
  });

  it("does not throw on pictures already closed or a close that throws", () => {
    const page = fakePage();
    const closed = new FakePicture();
    closed.close();
    const throwing = new FakePicture(() => {
      throw new Error("InvalidStateError");
    });
    const fine = new FakePicture();
    releaseOnLeave({
      pictures: listOf(closed, throwing, fine),
      page,
      stopDrawing: () => {
        throw new Error("no ticker");
      },
    });

    pageHide(page, false);
    expect(() => hide(page)).not.toThrow();
    expect(closed.closes).toBe(1);
    expect(throwing.closes).toBe(1);
    expect(fine.closes).toBe(1);
  });

  it("reloads a page shown again after its pictures were closed", () => {
    const page = fakePage();
    releaseOnLeave({ pictures: listOf(new FakePicture()), page });

    pageHide(page, false);
    hide(page);
    page.window.dispatchEvent(new Event("pageshow"));
    expect(page.reloads).toBe(1);
  });

  it("a page shown again before closing keeps its pictures and does not reload", () => {
    const page = fakePage();
    const picture = new FakePicture();
    releaseOnLeave({ pictures: listOf(picture), page });

    pageHide(page, false);
    page.window.dispatchEvent(new Event("pageshow"));
    hide(page);
    expect(picture.closes).toBe(0);
    expect(page.reloads).toBe(0);
  });

  it("listens to nothing once stopped", () => {
    const page = fakePage();
    const picture = new FakePicture();
    const stop = releaseOnLeave({ pictures: listOf(picture), page });

    pageHide(page, false);
    stop();
    hide(page);
    unload(page);
    expect(picture.closes).toBe(0);
  });
});

describe("PictureList", () => {
  it("ignores anything that is not a picture", () => {
    const list = new PictureList();
    list.note(null, isFake);
    list.note({ width: 3, close: () => undefined }, isFake);
    list.note(new FakePicture(), isFake);
    expect(list.size).toBe(1);
  });

  it("closeAll counts only pictures it closed and forgets them", () => {
    const open = new FakePicture();
    const closed = new FakePicture();
    closed.close();
    const list = listOf(open, closed);
    expect(list.closeAll()).toBe(1);
    expect(list.closeAll()).toBe(0);
    expect(list.size).toBe(0);
  });
});

describe("notePictureLoads", () => {
  const original = loadTextures.load as NonNullable<typeof loadTextures.load>;
  afterEach(() => {
    loadTextures.load = original;
  });

  it("notes the picture behind each texture Pixi's loader makes, wrapping the loader once", async () => {
    const picture = new FakePicture();
    const texture = { source: { resource: picture } };
    loadTextures.load = (async () => texture) as unknown as NonNullable<typeof loadTextures.load>;
    const noted: unknown[] = [];
    const list = { note: (value: unknown) => noted.push(value) } as unknown as PictureList;

    notePictureLoads(list);
    const wrapped = loadTextures.load;
    notePictureLoads(list);
    expect(loadTextures.load).toBe(wrapped);

    const result: unknown = await loadTextures.load?.("yard.png");
    expect(result).toBe(texture);
    expect(noted).toEqual([picture]);
  });
});
