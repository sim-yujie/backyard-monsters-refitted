import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Layout faults from the profiles test (7 Nov). jsdom lays nothing out, so
 * these pin the rules that fix them; the tester's re-shoots show them working.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (path: string): string =>
  readFileSync(resolve(here, path), "utf8").replace(/\r\n/g, "\n");
const squash = (text: string): string => text.replace(/\s+/g, " ");

describe("profile layout rules", () => {
  it("gives the chat room less height while a player's strip is up, and keeps the strip over the dock", () => {
    const chat = squash(css("../styles/chat.css"));
    expect(chat).toContain(
      ".chat-box--open:has(> .chat-box__player:not([hidden])) > .chat-box__lines { height: clamp(48px, calc(100dvh - var(--chat-top) - 229px - 230px - 13px), 260px); }",
    );
    expect(chat).toContain(
      ".chat-box--open:has(> .chat-box__player:not([hidden])) { z-index: 1; }",
    );
  });

  it("sizes the crop frame in the style sheet and lays a sideways phone out side by side", () => {
    const profile = squash(css("profile.css"));
    expect(profile).toContain("width: var(--crop-side); height: var(--crop-side);");
    expect(profile).toContain(".profile--crop .photo-crop { display: contents; }");
    expect(profile).toContain(
      "--crop-side: clamp(120px, calc(100dvh - 160px), var(--crop-frame, 260px));",
    );
  });

  it("keeps the report row one height: the question on its own line above the plates", () => {
    const profile = squash(css("profile.css"));
    expect(profile).toContain("min-height: calc(46px + var(--space-1) + var(--report-ask-line));");
    expect(profile).toContain(".profile__report-ask { flex: 0 0 100%;");
    expect(profile).toMatch(/\.profile__report-no \{ flex: 0 0 auto; white-space: nowrap; \}/);
  });

  it("lets dashboard photo cases wrap chips whole instead of breaking the name mid-word", () => {
    const admin = squash(css("../../admin/admin.css"));
    expect(admin).toContain(".photo-case .row-top { flex-wrap: wrap; gap: 6px 8px; }");
    expect(admin).toContain(".photo-case .report-who { overflow-wrap: break-word;");
    expect(admin).toContain(".photo-case__reporters > .icon { flex: none;");
  });

  it("puts a reported photo beside its case in the dashboard", () => {
    const admin = squash(css("../../admin/admin.css"));
    expect(admin).toMatch(
      /\.photo-case \{ grid-template-columns: 96px minmax\(0, 1fr\);[^}]*padding: 14px 12px 14px 16px;/,
    );
  });
});
