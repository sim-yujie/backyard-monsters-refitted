import { buildRiverPicture, type RiverAnswer, type RiverRequest } from "./riverPicture";

/**
 * Builds river pictures (`riverPicture.ts`) in a Web Worker, so the 10-45 ms build no longer
 * stalls a frame of the map; on the main thread at once where a worker cannot start or fails.
 *
 * One request at a time: a request sent while another is out is refused, and the caller asks again
 * once the answer has landed. So every answer is applied (none is thrown away), and a quick pan
 * never leaves the picture waiting behind a queue of builds for places the view has already left.
 */

/** Where a picture was built: in the worker, or on the main thread (no worker, or it failed). */
export type RiverServedBy = "worker" | "main";

export interface RiverBuilt extends RiverAnswer {
  servedBy: RiverServedBy;
  /** From the request to the answer, in ms. */
  ms: number;
}

/** What the builder needs of a worker (a test passes its own). */
export interface RiverWorkerLike {
  onmessage: ((event: MessageEvent<RiverAnswer>) => void) | null;
  onerror: ((event: Event) => void) | null;
  postMessage(message: RiverRequest): void;
  terminate(): void;
}

/** Starts the river worker, or null where the browser has none (or refuses this one). */
export const startRiverWorker = (): RiverWorkerLike | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./riverWorker.ts", import.meta.url), { type: "module" }) as RiverWorkerLike;
  } catch {
    return null;
  }
};

export class RiverBuilder {
  private worker: RiverWorkerLike | null;
  private out: { request: RiverRequest; sentAt: number } | null = null;
  private landed: RiverBuilt | null = null;

  constructor(start: () => RiverWorkerLike | null = startRiverWorker) {
    this.worker = start();
    if (this.worker) {
      this.worker.onmessage = (event) => this.answer(event.data);
      this.worker.onerror = (event) => {
        event.preventDefault?.();
        this.fail();
      };
    }
  }

  /** Whether a request is out. */
  get busy(): boolean {
    return this.out !== null;
  }

  /** Whether pictures are built in a worker (false: on the main thread). */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * Asks for a picture. Without a worker it is built now and can be taken at once. Returns false
   * (and sends nothing) while another request is out.
   */
  request(request: RiverRequest): boolean {
    if (this.out) return false;
    if (!this.worker) {
      this.landed = buildHere(request, performance.now());
      return true;
    }
    this.out = { request, sentAt: performance.now() };
    this.worker.postMessage(request);
    return true;
  }

  /** The picture that landed since the last call, once. */
  take(): RiverBuilt | null {
    const landed = this.landed;
    this.landed = null;
    return landed;
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.out = null;
    this.landed = null;
  }

  private answer(answer: RiverAnswer): void {
    const out = this.out;
    if (!out || answer.id !== out.request.id) return;
    this.out = null;
    this.landed = { ...answer, servedBy: "worker", ms: performance.now() - out.sentAt };
  }

  /** The worker failed: from now on pictures are built here, starting with the one it held. */
  private fail(): void {
    this.worker?.terminate();
    this.worker = null;
    const out = this.out;
    this.out = null;
    if (out) this.landed = buildHere(out.request, out.sentAt);
  }
}

const buildHere = (request: RiverRequest, sentAt: number): RiverBuilt => ({
  ...buildRiverPicture(request),
  servedBy: "main",
  ms: performance.now() - sentAt,
});
