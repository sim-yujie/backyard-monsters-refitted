// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http";
import type { MaintenanceNotice } from "@/api/maintenance";
import { maintenanceBlock, setMaintenanceBlock } from "./maintenanceBlock";
import { MaintenanceWatch, POLL_MS } from "./maintenanceWatch";

/**
 * The maintenance switch in a running game (owner, 22 Nov 2026): the
 * countdown card from the chat news or a poll, everyone but the owner signed
 * out at zero with the message kept for the sign-in screen, Off cancelling
 * it, and any refusal past the cut-off signing out too.
 */

const setup = (options: { chatOnline?: boolean; fetch?: () => Promise<MaintenanceNotice | null> } = {}) => {
  let clock = 0;
  let signedIn = true;
  let chatListener: (raw: unknown) => void = () => {};
  let refusalListener: (error: ApiError) => void = () => {};
  const banner = { show: vi.fn(), hide: vi.fn() };
  const signOut = vi.fn(() => {
    signedIn = false;
  });
  const fetch = vi.fn(options.fetch ?? (async () => ({ on: false, message: "", backAt: null, remainingMs: 0, exempt: false })));
  const watch = new MaintenanceWatch({
    chat: {
      onMaintenance: (listener) => {
        chatListener = listener;
        return () => {};
      },
      online: options.chatOnline ?? true,
    },
    onRefusal: (listener) => {
      refusalListener = listener;
      return () => {};
    },
    fetch,
    signedIn: () => signedIn,
    banner,
    signOut,
    now: () => clock,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  watch.start();
  return {
    watch,
    banner,
    signOut,
    fetch,
    chat: (raw: unknown) => chatListener(raw),
    refuse: (error: ApiError) => refusalListener(error),
    advance: (ms: number) => {
      clock += ms;
      watch.tick();
    },
    signIn: () => {
      signedIn = true;
    },
  };
};

const on = (remainingMs: number, exempt = false) => ({
  type: "maintenance",
  on: true,
  message: "Moving to a faster server",
  backAt: "2026-11-22T15:30:00.000Z",
  remainingMs,
  exempt,
});

const maintenanceError = (url = "http://x/api/v1/base/save") =>
  new ApiError("Maintenance", {
    status: 200,
    serverStatus: 403,
    details: { data: { reason: "maintenance", maintenanceMessage: "Moving", backAt: null } } as never,
    url,
  });

afterEach(() => setMaintenanceBlock(null));

describe("MaintenanceWatch", () => {
  it("shows the countdown from the chat news and redraws it as time passes", () => {
    const t = setup();
    t.chat(on(5 * 60_000));
    expect(t.banner.show).toHaveBeenLastCalledWith(expect.objectContaining({ remainingMs: 5 * 60_000, exempt: false }));
    t.advance(61_000);
    expect(t.banner.show).toHaveBeenLastCalledWith(expect.objectContaining({ remainingMs: 239_000 }));
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("signs a player out at zero, the message kept for the sign-in screen", () => {
    const t = setup();
    t.chat(on(60_000));
    t.advance(60_000);
    expect(t.signOut).toHaveBeenCalledTimes(1);
    expect(t.banner.hide).toHaveBeenCalled();
    expect(maintenanceBlock()).toEqual({ message: "Moving to a faster server", backAt: "2026-11-22T15:30:00.000Z", signedOut: true });
  });

  it("never signs the owner out: past zero his card says it is on", () => {
    const t = setup();
    t.chat(on(1_000, true));
    t.advance(5_000);
    expect(t.signOut).not.toHaveBeenCalled();
    expect(t.banner.show).toHaveBeenLastCalledWith(expect.objectContaining({ remainingMs: 0, exempt: true }));
  });

  it("Off during the countdown cancels it: the card goes, nobody is signed out", () => {
    const t = setup();
    t.chat(on(60_000));
    t.chat({ type: "maintenance", on: false, message: "", backAt: null, remainingMs: 0, exempt: false });
    expect(t.banner.hide).toHaveBeenCalled();
    t.advance(120_000);
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("any refusal for maintenance signs the player out at once, whatever was missed", () => {
    const t = setup();
    t.refuse(maintenanceError());
    expect(t.signOut).toHaveBeenCalledTimes(1);
    expect(maintenanceBlock()).toEqual({ message: "Moving", backAt: null, signedOut: true });
  });

  it("a refused sign-in only sets the sign-in screen's card; the screen handles it", () => {
    const t = setup();
    t.refuse(maintenanceError("http://x/api/v1/player/getinfo"));
    expect(t.signOut).not.toHaveBeenCalled();
    expect(maintenanceBlock()).toEqual({ message: "Moving", backAt: null });
  });

  it("a request refused on its way out (an attack's last save) keeps the Signed out mark", () => {
    const t = setup();
    t.chat(on(1_000));
    t.advance(1_000);
    t.refuse(maintenanceError());
    expect(t.signOut).toHaveBeenCalledTimes(1);
    expect(maintenanceBlock()).toEqual({ message: "Moving", backAt: null, signedOut: true });
  });

  it("other refusals are not its business", () => {
    const t = setup();
    t.refuse(new ApiError("Nope", { status: 403 }));
    expect(t.signOut).not.toHaveBeenCalled();
  });

  it("asks once on signing in, then every half minute only while chat is down", async () => {
    const online = setup({ chatOnline: true });
    online.advance(0);
    online.advance(POLL_MS * 3);
    expect(online.fetch).toHaveBeenCalledTimes(1);

    const offline = setup({ chatOnline: false });
    offline.advance(0);
    await Promise.resolve();
    offline.advance(POLL_MS);
    await Promise.resolve();
    offline.advance(POLL_MS);
    expect(offline.fetch).toHaveBeenCalledTimes(3);
  });

  it("a poll that finds the cut-off passed signs the player out", async () => {
    const t = setup({
      chatOnline: false,
      fetch: async () => ({ on: true, message: "Down", backAt: null, remainingMs: 0, exempt: false }),
    });
    t.advance(0);
    await vi.waitFor(() => expect(t.signOut).toHaveBeenCalledTimes(1));
  });

  it("news while signed out is ignored (the sign-in screen asks for itself)", () => {
    const t = setup();
    t.chat(on(60_000));
    t.advance(60_000);
    t.banner.show.mockClear();
    t.chat(on(60_000));
    t.advance(1_000);
    expect(t.banner.show).not.toHaveBeenCalled();
  });
});
