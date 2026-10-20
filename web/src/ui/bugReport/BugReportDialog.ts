import { sendBugReport, type BugReportResult, type GuestBugReportPayload } from "@/api/bugReport";
import { PRIVACY_URL } from "@/config";
import { BotCheck } from "@/app/scenes/turnstile";
import { reportContext, type ReportContext } from "@/game/bugReport/reportContext";
import { captureScreen, PictureError, preparePicture } from "@/game/bugReport/screenCapture";
import { Popup } from "@/ui/Popup";
import "./bug-report.css";

/**
 * The "Report a bug" form, from the Account menu (signed in) or the login
 * screen (signed out: an email for the reply, and the Turnstile check).
 *
 * The screenshot is taken the moment the form is asked for, before it opens,
 * so it shows what the player was looking at; they can look at it and take
 * it out before sending. They may add a picture of their own. The rest
 * (version, screen, device, browser, screen size, recent errors) is gathered
 * on its own (`game/bugReport/reportContext.ts`) and listed under the form.
 */

/** The longest report, as the server allows. */
export const MESSAGE_MAX = 2000;
const MESSAGE_MIN = 3;

export const THANK_YOU = "Thanks for telling us! Your report is on its way, and we'll use it to fix the problem.";

export interface BugReportOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** Signed in: the report goes with the account. Signed out: it asks for an email. */
  readonly signedIn: boolean;
  /** Signed out only: the build's Turnstile site key; empty shows no check. */
  readonly turnstileSiteKey?: string;
  /** Takes the screenshot; the real screen by default. */
  readonly capture?: () => Promise<string | null>;
  readonly send?: (payload: GuestBugReportPayload | Omit<GuestBugReportPayload, "email">, signedIn: boolean) => Promise<BugReportResult>;
  readonly context?: () => ReportContext;
  readonly picture?: (file: File) => Promise<string>;
  readonly onClose?: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const button = (className: string, text: string): HTMLButtonElement => {
  const element = el("button", `btn ${className}`, text);
  element.type = "button";
  return element;
};

let opened = 0;

/** Opens the form. The screenshot is started at once, before the popup is drawn. */
export const openBugReport = (options: BugReportOptions): Popup => {
  // Before anything else is drawn: the picture is of the screen as it was.
  const shooting = (options.capture ?? captureScreen)().catch(() => null);
  const context = (options.context ?? reportContext)();
  const send = options.send ?? sendBugReport;
  const readPicture = options.picture ?? preparePicture;
  const id = `bug-report-${++opened}`;

  let botCheck: BotCheck | null = null;
  const popup = new Popup({
    title: "Report a bug",
    className: "bug-report-popup",
    // A stray tap on the scrim must not throw away what was typed.
    closeOnBackdrop: false,
    onClose: () => {
      botCheck?.destroy();
      botCheck = null;
      options.onClose?.();
    },
  });

  const form = el("form", "bug-report");
  form.noValidate = true;

  form.append(el("p", "bug-report__intro", "Tell us what went wrong and we'll look into it."));

  // Signed out: an email for the reply.
  let email: HTMLInputElement | null = null;
  if (!options.signedIn) {
    const wrapper = el("div", "field");
    const label = el("label", "field__label", "Your email (so we can reply)");
    label.htmlFor = `${id}-email`;
    email = el("input", "field__input");
    email.id = label.htmlFor;
    email.type = "email";
    email.name = "email";
    email.autocomplete = "email";
    email.required = true;
    email.autocapitalize = "none";
    email.spellcheck = false;
    wrapper.append(label, email);
    form.append(wrapper);
  }

  // The player's words.
  const words = el("div", "field");
  const wordsLabel = el("label", "field__label", "What happened?");
  wordsLabel.htmlFor = `${id}-message`;
  const message = el("textarea", "field__input bug-report__message");
  message.id = wordsLabel.htmlFor;
  message.name = "message";
  message.rows = 5;
  message.maxLength = MESSAGE_MAX;
  message.required = true;
  message.placeholder = "What were you doing, and what went wrong?";
  const counter = el("p", "field__hint bug-report__counter", `0 / ${MESSAGE_MAX}`);
  counter.id = `${id}-count`;
  message.setAttribute("aria-describedby", counter.id);
  message.addEventListener("input", () => {
    counter.textContent = `${message.value.length} / ${MESSAGE_MAX}`;
  });
  words.append(wordsLabel, message, counter);
  form.append(words);

  // The screenshot, shown so the player knows what goes, and can take it out.
  let screenshot: string | null = null;
  let screenshotKept = true;
  const shotBox = el("div", "bug-report__attachment bug-report__screenshot");
  const shotTitle = el("p", "bug-report__attachment-title", "Screenshot of your game");
  const shotPreview = el("div", "bug-report__preview");
  const shotNote = el("p", "bug-report__attachment-note", "Taking a picture of your screen…");
  const shotToggle = button("btn--ghost bug-report__attachment-button", "Remove");
  shotToggle.hidden = true;
  shotBox.append(shotTitle, shotPreview, shotNote, shotToggle);
  form.append(shotBox);

  const drawScreenshot = (): void => {
    shotPreview.replaceChildren();
    if (screenshot === null) {
      shotNote.textContent = "We couldn't take a picture of your screen. You can add one below.";
      shotToggle.hidden = true;
      return;
    }
    shotToggle.hidden = false;
    if (screenshotKept) {
      const image = el("img", "bug-report__image");
      image.src = screenshot;
      image.alt = "The screenshot that will be sent";
      shotPreview.append(image);
      shotNote.textContent = "";
      shotNote.hidden = true;
      shotToggle.textContent = "Remove";
    } else {
      shotNote.hidden = false;
      shotNote.textContent = "Removed: no screenshot will be sent.";
      shotToggle.textContent = "Put it back";
    }
  };
  shotToggle.addEventListener("click", () => {
    screenshotKept = !screenshotKept;
    drawScreenshot();
  });
  void shooting.then((url) => {
    screenshot = url;
    drawScreenshot();
  });

  // A picture of the player's own.
  let picture: string | null = null;
  const pictureBox = el("div", "bug-report__attachment bug-report__picture");
  const pictureTitle = el("p", "bug-report__attachment-title", "Add a picture (optional)");
  const picturePreview = el("div", "bug-report__preview");
  const pictureError = el("p", "form-error bug-report__picture-error");
  pictureError.setAttribute("role", "alert");
  const file = el("input", "bug-report__file");
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp,image/*";
  file.id = `${id}-picture`;
  file.setAttribute("aria-label", "Add a picture");
  const pick = button("btn--outline bug-report__attachment-button", "Choose a picture");
  const dropPicture = button("btn--ghost bug-report__attachment-button", "Remove");
  dropPicture.hidden = true;
  pick.addEventListener("click", () => file.click());
  dropPicture.addEventListener("click", () => {
    picture = null;
    picturePreview.replaceChildren();
    dropPicture.hidden = true;
    pick.textContent = "Choose a picture";
    pick.focus();
  });
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    pictureError.textContent = "";
    pick.disabled = true;
    void readPicture(chosen)
      .then((url) => {
        picture = url;
        const image = el("img", "bug-report__image");
        image.src = url;
        image.alt = "The picture you added";
        picturePreview.replaceChildren(image);
        dropPicture.hidden = false;
        pick.textContent = "Choose another";
      })
      .catch((err: unknown) => {
        pictureError.textContent = err instanceof PictureError ? err.message : "That picture couldn't be opened. Try a JPEG or PNG.";
      })
      .finally(() => {
        pick.disabled = false;
      });
  });
  const pictureButtons = el("div", "bug-report__buttons-row");
  pictureButtons.append(pick, dropPicture);
  pictureBox.append(pictureTitle, picturePreview, pictureButtons, pictureError, file);
  form.append(pictureBox);

  // What else goes, in plain words.
  const also = el("p", "bug-report__also");
  const privacy = el("a", "", "Privacy Policy");
  privacy.href = PRIVACY_URL;
  privacy.target = "_blank";
  privacy.rel = "noopener";
  also.append(
    `We also send your ${options.signedIn ? "player name, " : ""}game version, which screen you were on, your device and browser, your screen size and any recent game errors. We only use them to fix bugs (`,
    privacy,
    ").",
  );
  form.append(also);

  if (!options.signedIn && options.turnstileSiteKey) {
    botCheck = new BotCheck(options.turnstileSiteKey, "bug_report");
    form.append(botCheck.element);
    void botCheck.mount();
  }

  const error = el("p", "form-error bug-report__error");
  error.setAttribute("role", "alert");
  const actions = el("div", "bug-report__actions");
  const cancel = button("btn--ghost", "Cancel");
  cancel.addEventListener("click", () => popup.close());
  const submit = el("button", "btn btn--primary", "Send report");
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(error, actions);

  const thankYou = (): void => {
    botCheck?.destroy();
    botCheck = null;
    const done = el("div", "bug-report bug-report--done");
    done.setAttribute("role", "status");
    done.append(el("p", "bug-report__thanks", THANK_YOU));
    const close = button("btn--primary", "Back to the game");
    if (!options.signedIn) close.textContent = "Close";
    close.addEventListener("click", () => popup.close());
    done.append(close);
    popup.setContent(done);
    close.focus();
  };

  let sending = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending) return;
    const text = message.value.trim();
    const typedEmail = email?.value.trim() ?? "";
    if (email && !/^\S+@\S+\.\S+$/.test(typedEmail)) {
      error.textContent = "Please enter your email address, so we can reply.";
      email.focus();
      return;
    }
    if (text.length < MESSAGE_MIN) {
      error.textContent = "Please tell us a little about what went wrong.";
      message.focus();
      return;
    }
    if (botCheck && !botCheck.token) {
      error.textContent = "Please finish the check that you're a person first.";
      return;
    }
    error.textContent = "";
    sending = true;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const payload = {
      ...context,
      message: text,
      ...(screenshot && screenshotKept ? { screenshot } : {}),
      ...(picture ? { picture } : {}),
      ...(email ? { email: typedEmail } : {}),
      ...(botCheck?.token ? { turnstileToken: botCheck.token } : {}),
    };
    void send(payload, options.signedIn).then((result) => {
      sending = false;
      submit.disabled = false;
      submit.textContent = "Send report";
      if (result.ok) {
        thankYou();
        return;
      }
      error.textContent = result.message;
      // A Turnstile token is spent by its check, whatever the answer.
      botCheck?.reset();
      if (result.limit) submit.disabled = true;
    });
  });

  popup.setContent(form).mount(options.container);
  (email ?? message).focus({ preventScroll: true });
  return popup;
};
