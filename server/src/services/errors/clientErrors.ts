import type { EntityManager } from "@mikro-orm/postgresql";

import type { ClientErrorsBody } from "../../schemas/ClientErrorSchemas.js";
import { noteErrors } from "../stats/activity.js";
import { cleanMessage, cleanPlace, cleanStack, errorFingerprint } from "./errorText.js";
import { recordErrors, type ErrorEntry } from "./errorStore.js";

/**
 * One batch of browser errors from the web client, cleaned
 * (`errorText.ts`), merged by kind, and stored (`errorStore.ts`) with the
 * sender's account number when signed in. Returns how many kinds were kept.
 */
export const acceptClientErrors = async (
  em: EntityManager,
  body: ClientErrorsBody,
  userid: number | null,
  now: Date = new Date()
): Promise<number> => {
  const byKind = new Map<string, ErrorEntry>();
  let occurrences = 0;
  for (const item of body.errors) {
    const message = cleanMessage(item.kind === "rejection" ? `Unhandled rejection: ${item.message}` : item.message);
    const place = cleanPlace(item.place);
    const fingerprint = errorFingerprint("browser", message, place);
    occurrences += item.count;
    const known = byKind.get(fingerprint);
    byKind.set(
      fingerprint,
      known
        ? { ...known, count: known.count + item.count }
        : {
            source: "browser",
            fingerprint,
            message,
            place,
            stack: cleanStack(item.stack),
            count: item.count,
            at: now,
            gameVersion: body.gameVersion,
            screen: body.screen,
            userid,
          }
    );
  }
  if (byKind.size === 0) return 0;
  noteErrors("browser", occurrences, now.getTime());
  return recordErrors(em, [...byKind.values()]);
};
