import { Status } from "../../enums/StatusCodes.js";
import { debugClientErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";
import { logger } from "../../utils/logger.js";

const LOG_LEVEL = {
  INFO: "info",
  ERROR: "err",
};

/** The longest client debug message kept in the log. */
export const MAX_DETAILS_LENGTH = 2000;

/** A field as text, at most `max` characters. */
const clip = (value: unknown, max: number): string => {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}... [${text.length - max} more]` : text;
};

interface DebugData {
  key: string;
  saveid: string;
  value: string;
}

/**
 * Controller to record debug data.
 *
 * This controller logs debug information sent from the client. It logs either an
 * error or info message depending on the key provided by the client. 
 *
 * @param {Context} ctx - The Koa context object, which includes the request body.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {Error} - Throws an error if the request body is missing required fields or if logging fails.
 */
export const recordDebugData: KoaController = async (ctx) => {
  try {
    const body = ctx.request.body as DebugData;

    if (!body.key || !body.saveid || !body.value) throw debugClientErr();

    // Anyone may call this, so each field is cut short: an 8 MB value per
    // request would otherwise fill the rotating log and push real records out.
    const properties = {
      key: clip(body.key, 16),
      saveid: clip(body.saveid, 64),
      details: clip(body.value, MAX_DETAILS_LENGTH),
    };

    if (body.key === LOG_LEVEL.ERROR) {
      logger.error("ERROR logged for basesaveid {saveid}. Details: {details}", properties);
    } else {
      logger.info("INFO logged for basesaveid {saveid}. Details: {details}", properties);
    }

    ctx.status = Status.OK;
    ctx.body = { error: 0 };
  } catch (err) {
    throw debugClientErr();
  }
};
