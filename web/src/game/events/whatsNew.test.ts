// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANGELOG, LATEST_RELEASE } from "@/data/changelog";
import { localSeen, markSeen, whatsNewDecision } from "./whatsNew";

const LATEST = { version: "2.0.0-beta.4" };

describe("whatsNewDecision", () => {
  it("pops up when the player has not seen the newest release", () => {
    expect(whatsNewDecision(LATEST, null, null, "done")).toBe("show");
    expect(whatsNewDecision(LATEST, "2.0.0-beta.3", null, "legacy")).toBe("show");
  });

  it("stays shut once it has been seen, on the server or, failing that, on this device", () => {
    expect(whatsNewDecision(LATEST, "2.0.0-beta.4", null, "done")).toBe("none");
    expect(whatsNewDecision(LATEST, null, "2.0.0-beta.4", "done")).toBe("none");
  });

  it("trusts the server's record over this device's", () => {
    expect(whatsNewDecision(LATEST, "2.0.0-beta.3", "2.0.0-beta.4", "done")).toBe("show");
  });

  it("only marks it seen while the guided start runs", () => {
    expect(whatsNewDecision(LATEST, null, null, "pending")).toBe("markSeen");
    expect(whatsNewDecision(LATEST, null, null, "active")).toBe("markSeen");
  });

  it("does nothing without a release", () => {
    expect(whatsNewDecision(undefined, null, null, "done")).toBe("none");
  });
});

describe("markSeen", () => {
  afterEach(() => window.localStorage.clear());

  it("records the release on the server and on this device", async () => {
    const send = vi.fn().mockResolvedValue({ error: 0 });
    await markSeen("2.0.0-beta.4", send);
    expect(send).toHaveBeenCalledWith("2.0.0-beta.4");
    expect(localSeen()).toBe("2.0.0-beta.4");
  });

  it("keeps this device's copy when the server cannot be reached", async () => {
    await markSeen("2.0.0-beta.4", vi.fn().mockRejectedValue(new Error("offline")));
    expect(localSeen()).toBe("2.0.0-beta.4");
  });
});

describe("the changelog", () => {
  it("lists releases newest first, each with cards that have a picture, a title and words", () => {
    expect(LATEST_RELEASE).toBe(CHANGELOG[0]);
    const versions = new Set<string>();
    for (const release of CHANGELOG) {
      expect(versions.has(release.version)).toBe(false);
      versions.add(release.version);
      expect(release.version).toMatch(/^[0-9A-Za-z.+-]{1,32}$/);
      expect(release.cards.length).toBeGreaterThan(0);
      for (const card of release.cards) {
        expect(card.image).toMatch(/^\/whats-new\/.+\.png$/);
        expect(card.title.length).toBeGreaterThan(0);
        expect(card.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("never mentions computer opponents", () => {
    const words = JSON.stringify(CHANGELOG).toLowerCase();
    expect(words).not.toMatch(/\bbots?\b|computer|\bai\b/);
  });
});
