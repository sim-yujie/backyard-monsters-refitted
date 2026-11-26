// A battle worker that lowers its own thread's priority first (Linux nice +NICE), then fights
// jobs on demand. Measurement only: shows what Bun allows (FFI gettid + os.setPriority).
import os from "node:os";
import { readFileSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
import { replayAbandonedAttack } from "../src/services/base/combat/abandonedAttack.js";
import { fightRaid } from "../src/services/raids/raidFight.js";
declare const self: Worker;
const nice = Number(process.env.NICE ?? 0);
let tid = 0;
let applied: number | null = null;
let how = "none";
try {
  const libc = dlopen("libc.so.6", { syscall: { args: [FFIType.i64], returns: FFIType.i64 } });
  tid = Number(libc.symbols.syscall(186)); // SYS_gettid on x86_64
  if (nice) {
    os.setPriority(tid, nice);
    how = "os.setPriority(tid)";
  }
  applied = Number(readFileSync(`/proc/self/task/${tid}/stat`, "utf8").split(") ")[1]!.split(" ")[16]);
} catch (err) {
  how = `failed: ${(err as Error).message}`;
}
self.onmessage = (event: MessageEvent<any>) => {
  const job = event.data;
  const t = performance.now();
  job.kind === "raid" ? fightRaid(job.input) : replayAbandonedAttack(job.input);
  self.postMessage({ done: true, ms: performance.now() - t });
};
self.postMessage({ ready: true, tid, applied, how });
