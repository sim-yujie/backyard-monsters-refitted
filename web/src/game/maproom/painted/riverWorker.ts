import { buildRiverPicture, type RiverRequest } from "./riverPicture";

/**
 * The river picture's worker (`riverBuilder.ts`): builds each request it is sent and hands the
 * picture's bytes back without copying them.
 */

/** The parts of a dedicated worker's scope used here (the project's types are the page's). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<RiverRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const answer = buildRiverPicture(event.data);
  scope.postMessage(answer, [answer.mask.bytes.buffer]);
};
