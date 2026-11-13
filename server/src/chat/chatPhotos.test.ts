import { describe, expect, mock, test } from "bun:test";
import { AllianceMessageType } from "../enums/Alliance.js";
import type { HistoryEntry } from "./chatProtocol.js";
import type { ChatClient } from "./chatState.js";

/**
 * Players' pictures in chat (owner, 13 Nov 2026): a line carries the
 * speaker's visible photo (`photo`) when they have one, and nothing more when
 * they do not. The rule itself is `services/profile/visiblePhoto.ts`'s; these
 * tests swap its database read for a list.
 */

mock.module("../server.js", () => ({ postgres: {}, redis: {} }));

const { CHAT_PHOTO_TTL_MS, speakerPhoto, withCurrentPhotos, withPhoto } = await import("./chatPhotos.js");

const line = (userId: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  userId,
  displayName: `[5] player${userId}`,
  picSquare: null,
  allianceImage: null,
  body: "hello",
  messageType: AllianceMessageType.MESSAGE,
  ts: 1,
  ...extra,
});

const client = (userId: number): ChatClient =>
  ({ userId, displayName: "[5] p", username: "p", picSquare: null, channels: new Map(), lastMsgAt: 0 }) as unknown as ChatClient;

/** A reader over a fixed list of visible photos, counting its reads. */
const reader = (photos: Record<number, number>) => {
  const calls: number[][] = [];
  const read = async (ids: readonly number[]) => {
    calls.push([...ids]);
    return new Map(ids.flatMap((id) => (photos[id] === undefined ? [] : [[id, photos[id]] as [number, number]])));
  };
  return { read, calls };
};

describe("withPhoto", () => {
  test("sets the upload number, and leaves no field at all for the critter", () => {
    expect(withPhoto(line(1), 4).photo).toBe(4);
    expect("photo" in withPhoto(line(1, { photo: 4 }), null)).toBe(false);
    expect(withPhoto(line(1), undefined)).toEqual(line(1));
  });
});

describe("withCurrentPhotos", () => {
  test("puts each speaker's photo as it is now on their lines, in one read for the room", async () => {
    const { read, calls } = reader({ 7: 3 });
    const history = [line(7), line(8, { photo: 2 }), line(7, { photo: 1 })];

    const shown = await withCurrentPhotos(history, read);

    expect(calls).toEqual([[7, 8]]);
    // A photo since hidden or removed (8's) goes; an older upload number (7's 1) is brought up to date.
    expect(shown.map((entry) => entry.photo)).toEqual([3, undefined, 3]);
    expect("photo" in shown[1]!).toBe(false);
  });

  test("an empty room reads nothing", async () => {
    const { read, calls } = reader({});
    expect(await withCurrentPhotos([], read)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a failed read opens the room with critters", async () => {
    const shown = await withCurrentPhotos([line(7, { photo: 1 })], async () => {
      throw new Error("down");
    });
    expect(shown).toEqual([line(7)]);
  });
});

describe("speakerPhoto", () => {
  test("reads the speaker's photo once a minute, not once a line", async () => {
    const photos: Record<number, number> = { 7: 2 };
    const { read, calls } = reader(photos);
    const speaker = client(7);

    expect(await speakerPhoto(speaker, 1_000, read)).toBe(2);
    photos[7] = 5;
    expect(await speakerPhoto(speaker, 1_000 + CHAT_PHOTO_TTL_MS - 1, read)).toBe(2);
    expect(calls.length).toBe(1);

    expect(await speakerPhoto(speaker, 1_000 + CHAT_PHOTO_TTL_MS, read)).toBe(5);
    expect(calls.length).toBe(2);
  });

  test("a photo hidden since shows the critter after the minute", async () => {
    const photos: Record<number, number> = { 7: 2 };
    const { read } = reader(photos);
    const speaker = client(7);

    await speakerPhoto(speaker, 0, read);
    delete photos[7];
    expect(await speakerPhoto(speaker, CHAT_PHOTO_TTL_MS, read)).toBeNull();
  });

  test("a failed read keeps the last photo known and tries again next line", async () => {
    const speaker = client(7);
    let fail = false;
    const read = async (ids: readonly number[]) => {
      if (fail) throw new Error("down");
      return new Map(ids.map((id) => [id, 9] as [number, number]));
    };

    expect(await speakerPhoto(speaker, 0, read)).toBe(9);
    fail = true;
    expect(await speakerPhoto(speaker, CHAT_PHOTO_TTL_MS, read)).toBe(9);
    fail = false;
    expect(await speakerPhoto(speaker, CHAT_PHOTO_TTL_MS + 1, read)).toBe(9);
  });

  test("no photo and no read yet: the critter", async () => {
    expect(await speakerPhoto(client(7), 0, async () => new Map())).toBeNull();
  });
});
