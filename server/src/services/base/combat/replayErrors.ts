/** The replay did not answer before its deadline, and was stopped. */
export class ReplayTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`The battle replay did not finish within ${deadlineMs} ms`);
    this.name = "ReplayTimeoutError";
  }
}

/**
 * The worker failed before it could take the job: its modules did not load,
 * so no battle was fought. On 22 Nov 2026 Bun 1.4.2's transpiler broke after
 * ~12,000 workers on the live server and every replay died like this
 * ("SyntaxError: Unexpected keyword 'else'"). It says nothing about the
 * attack, so a finaliser never counts it as a failed replay: the attack waits
 * for its next pass (`isReplayWorkerLoadError`, `replayRunner.ts`).
 */
export class ReplayWorkerLoadError extends Error {
  constructor(readonly reason: string) {
    super(`Battle replay worker failed to load: ${reason}`);
    this.name = "ReplayWorkerLoadError";
  }
}
