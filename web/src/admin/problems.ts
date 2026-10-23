import type { AdminHealthReport, DashboardSection } from "./api";

/**
 * What goes in the box at the top of the dashboard: everything wrong right
 * now, worst first, each pointing at the section that explains it. No DOM.
 */

export interface TopItem {
  /** "bad": something is broken; "warn": worth a look, or could not be checked. */
  level: "bad" | "warn";
  title: string;
  detail: string;
  section: DashboardSection;
}

const UNCHECKED: Record<string, { title: string; section: DashboardSection }> = {
  disk: { title: "Disk space could not be checked", section: "health" },
  backup: { title: "Backups could not be checked", section: "backups" },
  errors: { title: "The error rate could not be checked", section: "errors" },
};

export const topItems = (report: AdminHealthReport): TopItem[] => {
  const items: TopItem[] = report.problems.map((problem) => ({
    level: "bad",
    title: problem.title,
    detail: problem.detail,
    section: problem.section,
  }));
  for (const key of report.unchecked) {
    const known = UNCHECKED[key];
    items.push({
      level: "warn",
      title: known?.title ?? `"${key}" could not be checked`,
      detail: "The check could not run just now; it tries again every minute.",
      section: known?.section ?? "health",
    });
  }
  if (!report.telegram) {
    items.push({
      level: "warn",
      title: "Telegram alerts are off",
      detail:
        "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set on the server, so nothing is sent.",
      section: "health",
    });
  }
  return items;
};
