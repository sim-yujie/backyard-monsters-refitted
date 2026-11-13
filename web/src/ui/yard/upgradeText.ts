import { formatCountdown } from "@/ui/format";

/**
 * The words the yard puts on an upgrade time.
 *
 * Shared so the building panel and the repair block spell it the same way.
 *
 * Nothing here touches the DOM. It takes numbers and returns strings.
 */

/** "15m 0s", or "instant" for no time at all. */
export const describeSeconds = (seconds: number): string =>
  seconds <= 0 ? "instant" : formatCountdown(seconds);
