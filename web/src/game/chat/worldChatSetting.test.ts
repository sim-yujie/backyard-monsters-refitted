import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORLD_CHAT_KEY,
  onWorldChatChange,
  saveWorldChatOn,
  savedWorldChatOn,
  setWorldChatOn,
  worldChatOn,
} from "./worldChatSetting";

/** A `Storage` in memory, the way the browser's behaves. */
const memoryStore = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
};

afterEach(() => {
  setWorldChatOn(true, memoryStore());
});

describe("world chat setting", () => {
  it("is On when nothing is saved, or something unknown", () => {
    const store = memoryStore();
    expect(savedWorldChatOn(store)).toBe(true);
    store.setItem(WORLD_CHAT_KEY, "maybe");
    expect(savedWorldChatOn(store)).toBe(true);
    expect(savedWorldChatOn(null)).toBe(true);
  });

  it("saves Off as 'off' and On by forgetting it", () => {
    const store = memoryStore();
    expect(saveWorldChatOn(false, store)).toBe(true);
    expect(store.getItem(WORLD_CHAT_KEY)).toBe("off");
    expect(savedWorldChatOn(store)).toBe(false);
    expect(saveWorldChatOn(true, store)).toBe(true);
    expect(store.getItem(WORLD_CHAT_KEY)).toBeNull();
  });

  it("says when the browser would not keep it", () => {
    const broken = memoryStore();
    broken.setItem = () => {
      throw new Error("quota");
    };
    expect(saveWorldChatOn(false, broken)).toBe(false);
    expect(saveWorldChatOn(false, null)).toBe(false);
  });

  it("changes at once and tells its listeners, only on a real change", () => {
    const heard = vi.fn();
    const stop = onWorldChatChange(heard);
    expect(worldChatOn()).toBe(true);

    setWorldChatOn(false, memoryStore());
    expect(worldChatOn()).toBe(false);
    expect(heard).toHaveBeenLastCalledWith(false);

    setWorldChatOn(false, memoryStore());
    expect(heard).toHaveBeenCalledTimes(1);

    setWorldChatOn(true, memoryStore());
    expect(heard).toHaveBeenLastCalledWith(true);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    setWorldChatOn(false, memoryStore());
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("still changes for this visit when it cannot be saved", () => {
    expect(setWorldChatOn(false, null)).toBe(false);
    expect(worldChatOn()).toBe(false);
  });
});
