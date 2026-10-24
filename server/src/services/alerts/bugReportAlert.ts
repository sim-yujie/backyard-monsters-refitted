import { alertConfig, BUG_REPORT_ALERTS_PER_HOUR, dashboardLink, type AlertConfig } from "../../config/AlertConfig.js";
import { logger } from "../../utils/logger.js";
import { sendTelegram, type SendTelegram } from "./telegram.js";

/**
 * A Telegram message for each new bug report (docs/alerts.md), next to the
 * email, which is unchanged. It says only that a report arrived: its number,
 * how many came this hour, and a link to the dashboard's bug reports. Never
 * who sent it or what they wrote: Telegram is an outside service, so nothing
 * a player wrote and no name or email goes there (docs/alerts.md, "Privacy").
 * It is handed the report's number only, never the report.
 *
 * At most `BUG_REPORT_ALERTS_PER_HOUR` an hour: the next one says more are
 * coming, and the rest wait on the dashboard. The count is this server's own,
 * in memory; a restart starts it again.
 */

const HOUR_MS = 60 * 60 * 1000;

let hour = -1;
let sentThisHour = 0;

/** For tests: forget this hour's count. */
export const resetBugReportAlertCount = (): void => {
  hour = -1;
  sentThisHour = 0;
};

/** The alert's text: report `id`, the `count`th this hour. */
export const bugReportAlertText = (id: number, count: number, config: AlertConfig): string =>
  [`BYMR: new bug report #${id} (${count} this hour)`, dashboardLink("bugs", config)].filter(Boolean).join("\n");

/**
 * Sends the alert for one saved report. Never throws: a report is saved and
 * emailed whatever happens here.
 *
 * @returns {Promise<boolean>} Whether a message went.
 */
export const alertNewBugReport = async (
  id: number,
  { config = alertConfig(), send, now = Date.now() }: { config?: AlertConfig; send?: SendTelegram; now?: number } = {}
): Promise<boolean> => {
  if (!config.telegram) return false;
  try {
    const thisHour = Math.floor(now / HOUR_MS);
    if (thisHour !== hour) {
      hour = thisHour;
      sentThisHour = 0;
    }
    if (sentThisHour > BUG_REPORT_ALERTS_PER_HOUR) return false;
    sentThisHour++;

    const text =
      sentThisHour > BUG_REPORT_ALERTS_PER_HOUR
        ? [`BYMR: more than ${BUG_REPORT_ALERTS_PER_HOUR} bug reports this hour; the rest are on the dashboard.`, dashboardLink("bugs", config)]
            .filter(Boolean)
            .join("\n")
        : bugReportAlertText(id, sentThisHour, config);
    const outcome = await (send ?? ((message: string) => sendTelegram(message, { config })))(text);
    if (!outcome.sent) logger.warn(`Alerts: the Telegram message for bug report ${id} failed: ${outcome.reason}`);
    return outcome.sent;
  } catch (err) {
    logger.warn(`Alerts: the Telegram message for bug report ${id} failed: ${err}`);
    return false;
  }
};
