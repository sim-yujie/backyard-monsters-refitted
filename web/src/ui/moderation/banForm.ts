import { MAX_MOD_REASON, modReportsApi, refusalReason, type ModBanBody, type ModReportsApi } from "@/api/modReports";
import { make } from "@/ui/friends/rows";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { modBanDays } from "./modStatus";
import { REFUSAL_FALLBACK, REPORTS_TEXT as T, plural } from "./reportsText";
import "./reports.css";

/**
 * A moderator's ban (owner, 24 Nov 2026, "mod-ban-grilling"): 1, 3 or 7
 * days, a reason the player sees (also on the dashboard and on Telegram),
 * and "also remove their chat lines from the last hour", on by default.
 * The same fields in the Reports window (its confirm step) and in the sheet
 * a name in chat opens ({@link BanSheet}). The server refuses staff, the
 * moderator themselves and a shorter ban over a longer one.
 */

export interface BanFields {
  readonly element: HTMLElement;
  /** What the moderator picked; the reason as typed (checked on send). */
  read(): ModBanBody;
  focus(): void;
  /** Called with whether a reason is written, now and on every change (Confirm waits for one). */
  onReason(listener: (written: boolean) => void): void;
}

/** The ban's lengths, reason and remove-lines box, in the Reports window's look. */
export const banFields = (name: string): BanFields => {
  const form = make("div", "mod-reports__ban-fields");
  const choices = modBanDays();
  let days = choices[0] ?? 1;

  const field = make("div", "mod-reports__field");
  const lengths = make("div", "mod-reports__lengths mod-reports__lengths--days");
  lengths.setAttribute("role", "group");
  lengths.setAttribute("aria-label", T.howLong);
  for (const length of choices) {
    const chip = make("button", "mod-reports__seg");
    chip.type = "button";
    chip.dataset["days"] = String(length);
    chip.setAttribute("aria-pressed", String(length === days));
    chip.append(gameIcon("time", { size: 24, decorative: true }), plural(length, "day"));
    chip.addEventListener("click", () => {
      days = length;
      for (const other of lengths.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === chip));
    });
    lengths.append(chip);
  }
  field.append(make("span", "", T.howLong), lengths);

  const label = make("label", "mod-reports__field");
  const words = make("span", "", T.reason);
  words.append(" ", make("small", "", T.reasonWho));
  const reason = make("textarea", "");
  reason.rows = 2;
  reason.maxLength = MAX_MOD_REASON;
  reason.placeholder = T.sayWhy;
  reason.setAttribute("aria-label", `Reason for banning ${name}`);
  label.append(words, reason);

  const tick = make("label", "mod-reports__check");
  const box = make("input", "");
  box.type = "checkbox";
  box.checked = true;
  box.dataset["removeLines"] = "";
  tick.append(box, make("span", "", T.removeLines));

  form.append(field, label, tick);
  return {
    element: form,
    read: () => ({ days, reason: reason.value.trim(), removeLines: box.checked }),
    focus: () => reason.focus(),
    onReason: (listener) => {
      listener(reason.value.trim().length > 0);
      reason.addEventListener("input", () => listener(reason.value.trim().length > 0));
    },
  };
};

/** "Ana banned for 3 days. 2 of their chat lines removed." */
export const bannedWords = (name: string, days: number, removedLines: number | null): string =>
  `${name} banned for ${plural(days, "day")}.${removedLines ? ` ${plural(removedLines, "chat line")} removed.` : ""}`;

const failure = (caught: unknown): string => {
  const reason = refusalReason(caught);
  const words = caught instanceof Error && caught.message ? caught.message : null;
  return (reason && words) || (reason && REFUSAL_FALLBACK[reason]) || words || T.failed;
};

/** Sends a ban; the words to show, and whether it went. */
export const sendBan = async (api: ModReportsApi, userid: number, name: string, body: ModBanBody): Promise<{ ok: boolean; text: string }> => {
  if (!body.reason) return { ok: false, text: T.needReason };
  try {
    const done = await api.ban(userid, body);
    return { ok: true, text: bannedWords(name, body.days, done.removedLines) };
  } catch (caught) {
    return { ok: false, text: failure(caught) };
  }
};

export interface BanSheetOptions {
  readonly userid: number;
  /** The name as chat shows it ("[12] Ana"): the level is dropped. */
  readonly name: string;
  readonly api?: ModReportsApi;
  /** After a ban went: the chat box shows the words. */
  readonly onBanned?: (text: string) => void;
}

/** The ban from a name in chat: the Reports window's ban step in a small sheet. */
export class BanSheet {
  readonly popup: Popup;

  constructor(options: BanSheetOptions) {
    const api = options.api ?? modReportsApi;
    const name = options.name.replace(/^\[\d+\]\s*/, "");
    this.popup = new Popup({ title: T.actions.ban, className: "mod-reports-window mod-ban-sheet" });
    const fields = banFields(name);
    const pane = make("div", "mod-reports__confirm mod-ban-sheet__pane");
    pane.append(make("h3", "", T.ask.ban(name)), make("p", "", T.explain.ban), fields.element);
    const problem = make("p", "mod-reports__problem");
    problem.hidden = true;
    problem.setAttribute("role", "alert");
    const buttons = make("div", "mod-reports__confirm-buttons");
    const cancel = make("button", "btn btn--outline mod-reports__btn");
    cancel.dataset["cancel"] = "";
    cancel.type = "button";
    cancel.append(make("span", "mod-reports__btn-word", T.cancel));
    cancel.addEventListener("click", () => this.close());
    const confirm = make("button", "btn btn--primary mod-reports__btn mod-reports__danger");
    confirm.type = "button";
    confirm.dataset["confirm"] = "";
    confirm.append(make("span", "mod-reports__btn-word", T.confirm.ban));
    confirm.addEventListener("click", () => {
      const body = fields.read();
      if (!body.reason) {
        problem.hidden = false;
        problem.textContent = T.needReason;
        fields.focus();
        return;
      }
      cancel.disabled = true;
      confirm.disabled = true;
      void sendBan(api, options.userid, name, body).then((done) => {
        if (done.ok) {
          options.onBanned?.(done.text);
          this.close();
          return;
        }
        cancel.disabled = false;
        confirm.disabled = false;
        problem.hidden = false;
        problem.textContent = done.text;
      });
    });
    fields.onReason((written) => (confirm.disabled = !written));
    buttons.append(cancel, confirm);
    const foot = make("div", "mod-reports__actions mod-reports__confirm-foot");
    foot.append(problem, buttons);
    this.popup.body.append(pane, foot);
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    return this;
  }

  close(): void {
    this.popup.close();
  }
}
