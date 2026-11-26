import type { MaintenanceRefusal } from "@/api/maintenance";

/**
 * What the sign-in screen shows while maintenance keeps the player out
 * (`ui/MaintenanceCard.ts`): set by a refused sign-in, the countdown's end
 * (`app/maintenanceWatch.ts`) or the screen's own check; cleared when the
 * server says it is over. Unlike `signInNotice.ts` it is not taken once: a
 * second visit to the screen still shows it.
 */

let block: MaintenanceRefusal | null = null;
const listeners = new Set<(block: MaintenanceRefusal | null) => void>();

export const maintenanceBlock = (): MaintenanceRefusal | null => block;

export const setMaintenanceBlock = (next: MaintenanceRefusal | null): void => {
  if (
    block === next ||
    (block && next && block.message === next.message && block.backAt === next.backAt && !!block.signedOut === !!next.signedOut)
  ) {
    return;
  }
  block = next;
  for (const listener of [...listeners]) listener(block);
};

export const onMaintenanceBlock = (listener: (block: MaintenanceRefusal | null) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
