import { describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

const logged: Array<Record<string, string>> = [];
const record = (_: string, properties: Record<string, string>) => void logged.push(properties);
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(record), info: mock(record), debug: mock(() => {}) },
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
});
