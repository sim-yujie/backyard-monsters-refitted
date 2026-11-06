import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountInfo } from "@/api/account";
import { setAuthToken } from "@/api/http";
import { loadShinyLock, noteShinyLock, onShinyLock, resetShinyLockForTests, shinyLocked } from "./shinyLock";

const account = (shinyLocked: boolean) => Promise.resolve({ shinyLocked } as AccountInfo);
const settle = async () => {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
};

/** Shiny Lock for the HUD (bug report #10): read once per sign-in, set by the settings dialog. */
describe("Shiny Lock state", () => {
  beforeEach(() => {
    resetShinyLockForTests();
    setAuthToken("token-a");
  });
  afterEach(() => {
    setAuthToken(null);
    resetShinyLockForTests();
  });

  it("reads the account once per sign-in and tells listeners", async () => {
    const heard = vi.fn();
    onShinyLock(heard);
    const read = vi.fn(() => account(true));
    loadShinyLock(read);
    loadShinyLock(read);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(shinyLocked()).toBe(true);
    expect(heard.mock.calls).toEqual([[true]]);

    // Another sign-in reads again, starting from off.
    setAuthToken("token-b");
    loadShinyLock(vi.fn(() => account(false)));
    await settle();
    expect(shinyLocked()).toBe(false);
    expect(heard.mock.calls).toEqual([[true], [false]]);
  });

  it("does not read while signed out, and a failed read is tried again", async () => {
    setAuthToken(null);
    const read = vi.fn(() => account(true));
    loadShinyLock(read);
    expect(read).not.toHaveBeenCalled();

    setAuthToken("token-a");
    loadShinyLock(vi.fn(() => Promise.reject(new Error("offline"))));
    await settle();
    expect(shinyLocked()).toBe(false);
    loadShinyLock(read);
    await settle();
    expect(shinyLocked()).toBe(true);
  });

  it("the settings dialog's change is heard at once, and only a change is told", () => {
    const heard = vi.fn();
    onShinyLock(heard);
    noteShinyLock(true);
    noteShinyLock(true);
    noteShinyLock(false);
    expect(heard.mock.calls).toEqual([[true], [false]]);
  });
});
