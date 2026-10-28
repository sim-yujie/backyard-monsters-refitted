import { describe, expect, test } from "bun:test";

import { ANNOUNCEMENT_LIMITS, parseAnnouncement } from "./announcements.js";

/** The dashboard's announcement form, checked before anything reaches the database. */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const dataUrl = (bytes: Buffer, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;

const form = (overrides: Record<string, unknown> = {}) => ({
  title: "The game is free",
  body: "Backyard Monsters Revamped is free.\nIt always will be.",
  status: "published",
  startsAt: "",
  endsAt: "",
  images: [],
  ...overrides,
});

const refusal = (body: unknown): string => {
  const parsed = parseAnnouncement(body);
  if (parsed.ok) throw new Error("expected a refusal");
  return parsed.message;
};

describe("parseAnnouncement", () => {
  test("keeps a plain form, line breaks and all", () => {
    const parsed = parseAnnouncement(form());
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "The game is free",
        body: "Backyard Monsters Revamped is free.\nIt always will be.",
        status: "published",
        startsAt: null,
        endsAt: null,
        images: [],
      },
    });
  });

  test("tidies the text: Windows line breaks, control characters, runs of blank lines, spaces in the title", () => {
    const parsed = parseAnnouncement(form({ title: "  Two\n words ", body: "One\r\n\r\n\r\n\r\nTwo\u0007" }));
    expect(parsed.ok && parsed.value.title).toBe("Two words");
    expect(parsed.ok && parsed.value.body).toBe("One\n\nTwo");
  });

  test("keeps HTML as the words typed (the game shows it as text)", () => {
    const parsed = parseAnnouncement(form({ body: "<script>alert(1)</script>" }));
    expect(parsed.ok && parsed.value.body).toBe("<script>alert(1)</script>");
  });

  test("needs a title, text and a status", () => {
    expect(refusal(form({ title: " " }))).toBe("Give it a title.");
    expect(refusal(form({ body: "" }))).toBe("Write what it says.");
    expect(refusal(form({ status: "live" }))).toBe("Pick Draft or Published.");
    expect(refusal(null)).toBe("Give it a title.");
  });

  test("refuses a title or text that is too long", () => {
    expect(refusal(form({ title: "x".repeat(ANNOUNCEMENT_LIMITS.titleMax + 1) }))).toContain("title");
    expect(refusal(form({ body: "x".repeat(ANNOUNCEMENT_LIMITS.bodyMax + 1) }))).toContain("text");
  });

  test("reads the start and end times, and the end must come after the start", () => {
    const parsed = parseAnnouncement(form({ startsAt: "2026-11-01T10:00:00.000Z", endsAt: "2026-11-08T10:00:00.000Z" }));
    expect(parsed.ok && parsed.value.startsAt?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(parsed.ok && parsed.value.endsAt?.toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(refusal(form({ startsAt: "soon" }))).toBe("The start time is not a date.");
    expect(refusal(form({ endsAt: 12 }))).toBe("The end time is not a date.");
    expect(refusal(form({ startsAt: "2026-11-08T10:00:00Z", endsAt: "2026-11-01T10:00:00Z" }))).toBe(
      "The end time must be after the start time."
    );
  });

  test("takes new pictures as PNG, JPEG or WebP data, and kept ones by id", () => {
    const parsed = parseAnnouncement(form({ images: [{ keep: 7 }, { data: dataUrl(PNG) }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.images[0]).toEqual({ keep: 7 });
    expect(parsed.value.images[1]).toEqual({ type: "image/png", bytes: PNG });
  });

  test("reads the pictures' list sent on as JSON text, as the server's JSON body middleware does", () => {
    const parsed = parseAnnouncement(form({ images: JSON.stringify([{ keep: 3 }]) }));
    expect(parsed.ok && parsed.value.images).toEqual([{ keep: 3 }]);
    expect(refusal(form({ images: "[not json" }))).toBe("The pictures are not right. Reload the page.");
  });

  test("checks a picture by its bytes, not its label", () => {
    const gif = Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1");
    expect(refusal(form({ images: [{ data: dataUrl(gif, "image/png") }] }))).toBe(
      "Picture 1 must be a PNG, JPEG or WebP picture."
    );
    expect(refusal(form({ images: [{ data: dataUrl(PNG, "image/gif") }] }))).toBe(
      "Picture 1 must be a PNG, JPEG or WebP picture."
    );
    expect(refusal(form({ images: [{ data: "https://example.com/a.png" }] }))).toBe(
      "Picture 1 must be a PNG, JPEG or WebP picture."
    );
  });

  test("refuses too many pictures, a too-big one and a bad id", () => {
    const four = Array.from({ length: ANNOUNCEMENT_LIMITS.images + 1 }, () => ({ data: dataUrl(PNG) }));
    expect(refusal(form({ images: four }))).toBe(`At most ${ANNOUNCEMENT_LIMITS.images} pictures.`);
    const big = Buffer.concat([PNG, Buffer.alloc(ANNOUNCEMENT_LIMITS.imageBytesMax)]);
    expect(refusal(form({ images: [{ data: dataUrl(big) }] }))).toContain("Picture 1 is too big.");
    expect(refusal(form({ images: [{ keep: -1 }] }))).toBe("Picture 1 is not right. Reload the page.");
    expect(refusal(form({ images: "none" }))).toBe("The pictures are not right. Reload the page.");
  });
});
