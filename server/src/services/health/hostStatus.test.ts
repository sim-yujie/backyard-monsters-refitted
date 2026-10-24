import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseHostStatus, readHostStatus } from "./hostStatus.js";

/**
 * `status/host.json` as `deploy/host-status.sh` writes it. The fixture is a
 * real run of the script (in a Linux container, with a stand-in `docker` that
 * lists three containers), so a change to the script's output that the
 * server would no longer read fails here.
 */
const FIXTURE = readFileSync(new URL("./fixtures/host.json", import.meta.url), "utf8");

describe("host status", () => {
  const saved = process.env.HOST_STATUS_FILE;
  let dir: string | null = null;

  afterEach(() => {
    if (saved === undefined) delete process.env.HOST_STATUS_FILE;
    else process.env.HOST_STATUS_FILE = saved;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  test("reads what the script writes", () => {
    const status = parseHostStatus(FIXTURE);
    expect(status).not.toBeNull();
    expect(status!.memory.totalBytes).toBeGreaterThan(0);
    expect(status!.disks.length).toBe(1);
    expect(status!.containers?.map((one) => one.service)).toEqual(["web", "db", "backup"]);
    expect(status!.containers?.[0]).toMatchObject({ restartCount: 3, health: null, oomKilled: false });
    expect(status!.containers?.[2]).toMatchObject({ state: "exited", oomKilled: true, exitCode: 137 });
    expect(status!.backups).toMatchObject({ found: true, count: 2, partialCount: 1 });
  });

  test("a script that could not ask Docker, and an empty backups folder", () => {
    const status = parseHostStatus(
      JSON.stringify({
        ...JSON.parse(FIXTURE),
        containers: null,
        backups: { dir: "/b", found: true, count: 0, totalBytes: 0, partialCount: 0, newest: null },
      })
    );
    expect(status?.containers).toBeNull();
    expect(status?.backups).toMatchObject({ count: 0, newest: null });
  });

  test("anything else reads as no status", () => {
    expect(parseHostStatus("")).toBeNull();
    expect(parseHostStatus("{half")).toBeNull();
    expect(parseHostStatus(JSON.stringify({ ...JSON.parse(FIXTURE), version: 2 }))).toBeNull();
    expect(parseHostStatus(JSON.stringify({ ...JSON.parse(FIXTURE), disks: "full" }))).toBeNull();
  });

  test("reads the file HOST_STATUS_FILE names, and null when it is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "host-status-"));
    process.env.HOST_STATUS_FILE = join(dir, "host.json");
    expect(await readHostStatus()).toBeNull();
    writeFileSync(process.env.HOST_STATUS_FILE, FIXTURE);
    expect((await readHostStatus())?.hostname).toBe(JSON.parse(FIXTURE).hostname);
  });
});
