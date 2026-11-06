import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The pieces of the health checks that live outside the server's code
 * (docs/alerts.md): the compose mount, the host script's timer, and the
 * outside check on GitHub, which must stay off until the owner turns it on.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("health check deploy files", () => {
  test("the game server sees the host status read-only, and nothing more of the machine", () => {
    const compose = read("../../../docker-compose.prod.yml");
    const start = compose.indexOf("\n  web:");
    const web = compose.slice(start, compose.indexOf("\n  db:", start));
    expect(web).toContain("- ./status:/app/status:ro");
    expect(web).not.toContain("docker.sock");
    expect(web).not.toContain("./backups");
  });

  test("the timer runs the host script once a minute", () => {
    expect(read("../../../deploy/bymr-host-status.service")).toContain(
      "ExecStart=/usr/bin/env bash /opt/bymr/server/deploy/host-status.sh"
    );
    const timer = read("../../../deploy/bymr-host-status.timer");
    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(timer).toContain("WantedBy=timers.target");
  });

  test("the host script writes status/host.json in one step", () => {
    const script = read("../../../deploy/host-status.sh");
    expect(script).toStartWith("#!/usr/bin/env bash");
    expect(script).toContain('mv -f "$tmp" "$STATUS_DIR/host.json"');
    expect(script).not.toContain("\r");
  });

  test("the outside check is off until UPTIME_CHECK is on, and keeps its secrets in secrets", () => {
    const workflow = read("../../../../.github/workflows/uptime-check.yml");
    expect(workflow).toContain("if: vars.UPTIME_CHECK == 'on' || github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}");
    expect(workflow).toContain("TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}");
    // A Windows checkout may turn the workflow's line endings to CRLF.
    expect(workflow).toMatch(/permissions:\r?\n {2}contents: read\r?\n/);
    expect(read("../../../../.github/scripts/uptime-check.sh")).not.toContain("\r");
  });

  test("production.env.example leaves alerts off", () => {
    const example = read("../../../production.env.example");
    expect(example).toMatch(/^TELEGRAM_BOT_TOKEN=$/m);
    expect(example).toMatch(/^TELEGRAM_CHAT_ID=$/m);
  });
});

describe("Redis memory (security audit 2026-10-29)", () => {
  test("Redis has a memory cap under its container's, and drops only keys that expire", () => {
    const compose = read("../../../docker-compose.prod.yml");
    const start = compose.indexOf("\n  redis:\n    logging");
    const redis = compose.slice(start, compose.indexOf("\n  backup:", start));
    expect(redis).toContain('command: ["redis-server", "--maxmemory", "160mb", "--maxmemory-policy", "volatile-lru"]');
    expect(redis).toContain("memory: 256M");
    expect(redis).not.toContain("allkeys");
  });
});

