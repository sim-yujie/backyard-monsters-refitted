import { describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

const logged: Array<Record<string, string>> = [];
const levels: string[] = [];
const record = (level: string) => (_: string, properties: Record<string, string>) => {
  levels.push(level);
  logged.push(properties);
};
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(record("warn")), error: mock(record("error")), info: mock(record("info")), debug: mock(() => {}) },
}));

const { recordDebugData, MAX_DETAILS_LENGTH } = await import("./recordDebugData.js");

/**
 * Anyone may send client debug lines, so a huge one is cut short before it
 * reaches the log.
 */
describe("recordDebugData", () => {
  test("keeps a normal line whole and cuts a huge one short", async () => {
    const send = (value: string) =>
      recordDebugData({ request: { body: { key: "err", saveid: "123", value } } } as unknown as Context, async () => {});

    await send("Error #1009 at Building.Tick");
    expect(logged.at(-1)!.details).toBe("Error #1009 at Building.Tick");

    await send("x".repeat(5_000_000));
    expect(logged.at(-1)!.details.length).toBeLessThan(MAX_DETAILS_LENGTH + 40);
  });

  test("an anonymous client's \"err\" line is a warning, never a server error (audit L1)", async () => {
    levels.length = 0;
    const send = (key: string) =>
      recordDebugData({ request: { body: { key, saveid: "123", value: "x" } } } as unknown as Context, async () => {});

    await send("err");
    await send("info");

    expect(levels).toEqual(["warn", "info"]);
  });
});
