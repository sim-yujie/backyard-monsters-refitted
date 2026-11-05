import { announcementContent } from "@/ui/announcements/announcementContent";
import { giftAmount } from "@/ui/announcements/announcementGift";
import "@/ui/announcements/announcements.css";
import {
  deleteAnnouncement,
  fetchAnnouncementImage,
  fetchAnnouncements,
  saveAnnouncement,
  type AdminAnnouncement,
  type AnnouncementForm,
  type AnnouncementLimits,
  type AnnouncementStatus,
} from "./api";
import { h, replace } from "./dom";
import { ago, count, dateTime, plural } from "./format";
import { icon } from "./icons";
import { errorWords } from "./shiny";

/**
 * Announcements: the pop-ups the owner writes for players (server
 * `services/announcements/announcements.ts`). Each has a title, plain text
 * (line breaks kept, `https://` addresses become links), up to three
 * pictures, an optional start and end, an optional Shiny gift, and Draft or
 * Published. Players see the published ones in date after their yard loads,
 * once each, until they press "Got it" or claim the gift; the Account menu's
 * "News" shows them again. Publishing a gift asks once more, in place,
 * because it reaches every player and cannot be taken back.
 *
 * The preview beside the form is drawn by the game's own code
 * (`ui/announcements/announcementContent.ts`) in the game's colours, so it is
 * what players will see. A big picture is made smaller here before it is
 * sent.
 */

/** Until the server says otherwise. */
const DEFAULT_LIMITS: AnnouncementLimits = {
  titleMax: 80,
  bodyMax: 2000,
  images: 3,
  imageBytesMax: 1_000_000,
  shinyMax: 10_000,
};
const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** The widest picture kept as it is; wider ones are made this wide. */
const MAX_PICTURE_WIDTH = 1600;
/** Bigger files than this are read only to be made smaller. */
const MAX_FILE_BYTES = 20_000_000;

/** A picture in the form: one already saved, or one just picked. */
export type FormPicture =
  | { kind: "saved"; id: number; src: string }
  | { kind: "new"; data: string; src: string };

/** What the form holds, as typed. */
export interface Draft {
  title: string;
  body: string;
  status: AnnouncementStatus;
  /** `datetime-local` values (the owner's own clock), empty for none. */
  startsAt: string;
  endsAt: string;
  pictures: FormPicture[];
  /** The gift as typed, empty for none. */
  shiny: string;
}

const emptyDraft = (): Draft => ({
  title: "",
  body: "",
  status: "draft",
  startsAt: "",
  endsAt: "",
  pictures: [],
  shiny: "",
});

/** The gift as typed, as a number: 0 for none, NaN when it is not a number. */
export const giftOf = (draft: Pick<Draft, "shiny">): number => Number(draft.shiny.trim() || 0);

/** An ISO time as a `datetime-local` value on this computer's clock, or "". */
export const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A `datetime-local` value as ISO, or null for none (or one that is not a time). */
export const fromLocalInput = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Why the form cannot be saved, or null. */
export const draftProblem = (draft: Draft, limits: AnnouncementLimits): string | null => {
  if (!draft.title.trim()) return "Give it a title.";
  if (draft.title.trim().length > limits.titleMax)
    return `Keep the title to ${limits.titleMax} characters.`;
  if (!draft.body.trim()) return "Write what it says.";
  if (draft.body.trim().length > limits.bodyMax)
    return `Keep the text to ${count(limits.bodyMax)} characters.`;
  if (draft.startsAt && !fromLocalInput(draft.startsAt)) return "The start time is not a date.";
  if (draft.endsAt && !fromLocalInput(draft.endsAt)) return "The end time is not a date.";
  const start = fromLocalInput(draft.startsAt);
  const end = fromLocalInput(draft.endsAt);
  if (start && end && end <= start) return "The end time must be after the start time.";
  if (draft.pictures.length > limits.images) return `At most ${limits.images} pictures.`;
  const gift = giftOf(draft);
  if (!Number.isSafeInteger(gift) || gift < 0 || gift > limits.shinyMax)
    return `The gift must be a whole number of Shiny from 0 to ${count(limits.shinyMax)}.`;
  return null;
};

/** Whether saving publishes a gift players do not have yet, which asks once more. */
export const giftNeedsConfirm = (
  draft: Pick<Draft, "status" | "shiny">,
  saved: Pick<AdminAnnouncement, "status" | "shiny"> | undefined,
): boolean => {
  const gift = giftOf(draft);
  if (draft.status !== "published" || gift <= 0) return false;
  return saved?.status !== "published" || saved.shiny !== gift;
};

/** What Save sends for the form. */
export const formOf = (draft: Draft): AnnouncementForm => ({
  title: draft.title.trim(),
  body: draft.body.trim(),
  status: draft.status,
  startsAt: fromLocalInput(draft.startsAt),
  endsAt: fromLocalInput(draft.endsAt),
  images: draft.pictures.map((picture) =>
    picture.kind === "saved" ? { keep: picture.id } : { data: picture.data },
  ),
  shiny: giftOf(draft),
});

/** Why a picked file cannot be used, or null. */
export const pictureProblem = (file: Pick<File, "type" | "size">): string | null => {
  if (!PICTURE_TYPES.includes(file.type)) return "Pick a PNG, JPEG or WebP picture.";
  if (file.size > MAX_FILE_BYTES) return "That picture is far too big. Pick a smaller one.";
  return null;
};

export type Standing = { word: string; tone: "good" | "info" | "warn" | "quiet" };

/** Where an announcement stands for players now. */
export const standing = (
  item: Pick<AdminAnnouncement, "status" | "live" | "startsAt" | "endsAt">,
  now = Date.now(),
): Standing => {
  if (item.status === "draft") return { word: "Draft", tone: "quiet" };
  if (item.live) return { word: "Live", tone: "good" };
  if (item.startsAt && Date.parse(item.startsAt) > now)
    return { word: `Starts ${dateTime(item.startsAt)}`, tone: "info" };
  return { word: "Ended", tone: "warn" };
};

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The picture could not be read."));
    reader.readAsDataURL(blob);
  });

/**
 * A picked file as a data URL the server takes: as it is when small enough,
 * otherwise made at most {@link MAX_PICTURE_WIDTH} wide and saved as WebP
 * (JPEG where the browser cannot), smaller each try until it fits.
 */
const shrinkPicture = async (file: File, maxBytes: number): Promise<string> => {
  if (file.size <= maxBytes) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    const fits = bitmap !== null && bitmap.width <= MAX_PICTURE_WIDTH;
    bitmap?.close();
    if (fits) return readAsDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  let width = Math.min(bitmap.width, MAX_PICTURE_WIDTH);
  for (const quality of [0.86, 0.78, 0.7, 0.6]) {
    const height = Math.round((bitmap.height * width) / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    for (const type of ["image/webp", "image/jpeg"]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      if (blob && blob.type === type && blob.size <= maxBytes) {
        bitmap.close();
        return readAsDataUrl(blob);
      }
    }
    width = Math.round(width * 0.8);
  }
  bitmap.close();
  throw new Error("That picture is too big even made smaller. Pick a smaller one.");
};

export interface AnnouncementsOptions {
  say(message: string): void;
}

let fieldCount = 0;

/** The Announcements section: the list, and the form with its preview. */
export class AnnouncementsView {
  readonly element = h("div", { class: "announcements" });
  private items: AdminAnnouncement[] = [];
  private limits = DEFAULT_LIMITS;
  private loadError: string | null = null;
  private loaded = false;
  /** The one being written: null for a new one; undefined while the form is closed. */
  private editing: number | null | undefined = undefined;
  private draft: Draft = emptyDraft();
  private deleting: number | null = null;
  private busy = false;
  private problem: string | null = null;
  /** Save asked once more about publishing a gift, and the owner has not answered. */
  private confirmingGift = false;
  /** Blob URLs of saved pictures, by id, revoked when no longer shown. */
  private readonly savedSrc = new Map<number, string>();

  constructor(private readonly options: AnnouncementsOptions) {
    this.render();
  }

  async refresh(): Promise<void> {
    try {
      const answer = await fetchAnnouncements();
      this.items = answer.announcements;
      this.limits = answer.limits ?? DEFAULT_LIMITS;
      this.loadError = null;
    } catch (err) {
      this.loadError = `Could not load the announcements: ${errorWords(err)}`;
    }
    this.loaded = true;
    this.render();
  }

  /** Opens the form on a new announcement, or on a saved one. */
  async edit(id: number | null): Promise<void> {
    this.editing = id;
    this.problem = null;
    this.deleting = null;
    const item = id === null ? undefined : this.items.find((a) => a.id === id);
    this.draft = item
      ? {
          title: item.title,
          body: item.body,
          status: item.status,
          startsAt: toLocalInput(item.startsAt),
          endsAt: toLocalInput(item.endsAt),
          pictures: [],
          shiny: item.shiny > 0 ? String(item.shiny) : "",
        }
      : emptyDraft();
    this.render();
    if (!item) return;
    const pictures: FormPicture[] = [];
    for (const imageId of item.imageIds) {
      try {
        const src = this.savedSrc.get(imageId) ?? (await fetchAnnouncementImage(imageId));
        this.savedSrc.set(imageId, src);
        pictures.push({ kind: "saved", id: imageId, src });
      } catch {
        // A picture that cannot be shown is still kept unless the owner drops it.
        pictures.push({ kind: "saved", id: imageId, src: "" });
      }
    }
    if (this.editing !== id) return;
    this.draft = { ...this.draft, pictures };
    this.render();
  }

  private close(): void {
    this.editing = undefined;
    this.draft = emptyDraft();
    this.problem = null;
    this.confirmingGift = false;
    this.render();
  }

  private async save(confirmed = false): Promise<void> {
    const problem = draftProblem(this.draft, this.limits);
    if (problem) {
      this.problem = problem;
      this.render();
      return;
    }
    if (this.editing === undefined) return;
    const saved = this.items.find((item) => item.id === this.editing);
    if (!confirmed && giftNeedsConfirm(this.draft, saved)) {
      this.confirmingGift = true;
      this.problem = null;
      this.render();
      return;
    }
    this.confirmingGift = false;
    this.busy = true;
    this.problem = null;
    this.render();
    try {
      const answer = await saveAnnouncement(this.editing, formOf(this.draft));
      const saved = answer.announcement;
      this.options.say(
        saved.status === "published"
          ? `Saved. ${standing(saved).word === "Live" ? "Players see it now." : standing(saved).word + "."}`
          : "Saved as a draft.",
      );
      this.busy = false;
      this.close();
      await this.refresh();
    } catch (err) {
      this.busy = false;
      this.problem = `Not saved: ${errorWords(err)}`;
      this.render();
    }
  }

  private async remove(id: number): Promise<void> {
    this.busy = true;
    this.render();
    try {
      await deleteAnnouncement(id);
      this.options.say("Deleted. Players no longer see it.");
      if (this.editing === id) this.close();
      this.deleting = null;
      this.busy = false;
      await this.refresh();
    } catch (err) {
      this.busy = false;
      this.deleting = null;
      this.options.say(`Not deleted: ${errorWords(err)}`);
      this.render();
    }
  }

  private async addPictures(files: FileList | null): Promise<void> {
    if (!files) return;
    for (const file of [...files]) {
      if (this.draft.pictures.length >= this.limits.images) {
        this.problem = `At most ${this.limits.images} pictures.`;
        break;
      }
      const bad = pictureProblem(file);
      if (bad) {
        this.problem = bad;
        continue;
      }
      try {
        const data = await shrinkPicture(file, this.limits.imageBytesMax);
        this.draft = {
          ...this.draft,
          pictures: [...this.draft.pictures, { kind: "new", data, src: data }],
        };
        this.problem = null;
      } catch (err) {
        this.problem = errorWords(err);
      }
    }
    this.render();
  }

  private render(): void {
    const list = this.renderList();
    replace(this.element, this.editing === undefined ? null : this.renderEditor(), list);
  }

  private renderList(): HTMLElement {
    const head = h(
      "div",
      { class: "actions split" },
      h(
        "p",
        { class: "note" },
        "Pop-ups players see after their yard loads, until they press “Got it”.",
      ),
      this.editing === undefined
        ? h(
            "button",
            {
              class: "button primary",
              attrs: { type: "button" },
              onClick: () => void this.edit(null),
            },
            "New announcement",
          )
        : null,
    );
    if (!this.loaded)
      return h("div", { class: "group" }, head, h("div", { class: "skeleton" }));
    if (this.loadError)
      return h(
        "div",
        { class: "group" },
        head,
        h("p", { class: "form-error" }, this.loadError),
      );
    if (this.items.length === 0) {
      return h(
        "div",
        { class: "group" },
        head,
        h("div", { class: "empty" }, h("p", {}, "No announcements yet.")),
      );
    }
    return h(
      "div",
      { class: "group" },
      head,
      h("ul", { class: "ann-list" }, ...this.items.map((item) => this.renderRow(item))),
    );
  }

  private renderRow(item: AdminAnnouncement): HTMLElement {
    const state = standing(item);
    const confirming = this.deleting === item.id;
    return h(
      "li",
      { class: `ann-row${this.editing === item.id ? " is-editing" : ""}` },
      h(
        "span",
        { class: "row-main" },
        h("span", { class: "row-title" }, item.title),
        h(
          "span",
          { class: "row-meta" },
          h("span", { class: `chip chip-${state.tone}` }, state.word),
          " ",
          item.endsAt ? `until ${dateTime(item.endsAt)} · ` : "",
          item.imageIds.length > 0 ? `${plural(item.imageIds.length, "picture")} · ` : "",
          item.shiny > 0 ? `Gift ${count(item.shiny)} Shiny · ${count(item.claims)} claimed · ` : "",
          item.status === "published" ? `${count(item.dismissals)} pressed Got it · ` : "",
          h(
            "time",
            { attrs: { datetime: item.updatedAt, title: dateTime(item.updatedAt) } },
            `changed ${ago(item.updatedAt)}`,
          ),
        ),
      ),
      confirming
        ? h(
            "span",
            { class: "ann-row-actions confirm-inline" },
            h("span", {}, "Delete for everyone?"),
            h(
              "button",
              {
                class: "button quiet",
                attrs: { type: "button" },
                onClick: () => {
                  this.deleting = null;
                  this.render();
                },
              },
              "Keep",
            ),
            h(
              "button",
              {
                class: "button danger",
                attrs: { type: "button", ...(this.busy && { disabled: "" }) },
                onClick: () => void this.remove(item.id),
              },
              "Delete",
            ),
          )
        : h(
            "span",
            { class: "ann-row-actions" },
            h(
              "button",
              {
                class: "button quiet",
                attrs: { type: "button" },
                onClick: () => void this.edit(item.id),
              },
              "Edit",
            ),
            h(
              "button",
              {
                class: "button quiet",
                attrs: { type: "button" },
                onClick: () => {
                  this.deleting = item.id;
                  this.render();
                },
              },
              "Delete",
            ),
          ),
    );
  }

  private renderEditor(): HTMLElement {
    const n = ++fieldCount;
    const limits = this.limits;
    const draft = this.draft;
    const preview = h("div", { class: "ann-preview-slot" });
    const drawPreview = () => replace(preview, this.renderPreview());
    const set = (patch: Partial<Draft>) => {
      this.draft = { ...this.draft, ...patch };
      this.problem = null;
      problem.hidden = true;
      this.confirmingGift = false;
      giftConfirm.hidden = true;
      formActions.hidden = false;
      drawPreview();
    };

    const title = h("input", {
      class: "field-input",
      attrs: {
        id: `ann-title-${n}`,
        type: "text",
        maxlength: String(limits.titleMax),
        autocomplete: "off",
        placeholder: "For example: The game is free",
      },
    });
    title.value = draft.title;
    const titleCount = h("span", { class: "counter" });
    const body = h("textarea", {
      class: "field-input notes ann-body",
      attrs: { id: `ann-body-${n}`, maxlength: String(limits.bodyMax), rows: "8" },
    });
    body.value = draft.body;
    const bodyCount = h("span", { class: "counter" });
    const counts = () => {
      titleCount.textContent = `${title.value.length} / ${limits.titleMax}`;
      bodyCount.textContent = `${count(body.value.length)} / ${count(limits.bodyMax)}`;
    };
    counts();
    title.addEventListener("input", () => {
      counts();
      set({ title: title.value });
    });
    body.addEventListener("input", () => {
      counts();
      set({ body: body.value });
    });

    const startsAt = h("input", {
      class: "field-input",
      attrs: { id: `ann-start-${n}`, type: "datetime-local" },
    });
    startsAt.value = draft.startsAt;
    startsAt.addEventListener("input", () => set({ startsAt: startsAt.value }));
    const endsAt = h("input", {
      class: "field-input",
      attrs: { id: `ann-end-${n}`, type: "datetime-local" },
    });
    endsAt.value = draft.endsAt;
    endsAt.addEventListener("input", () => set({ endsAt: endsAt.value }));

    const savedItem = this.items.find((item) => item.id === this.editing);
    const claims = savedItem?.claims ?? 0;
    const gift = h("input", {
      class: "field-input",
      attrs: {
        id: `ann-gift-${n}`,
        type: "number",
        min: "0",
        max: String(limits.shinyMax),
        step: "1",
        inputmode: "numeric",
        placeholder: "No gift",
        ...(claims > 0 && { disabled: "" }),
      },
    });
    gift.value = draft.shiny;
    gift.addEventListener("input", () => set({ shiny: gift.value }));

    const statusButtons = (["draft", "published"] as const).map((status) =>
      h(
        "button",
        {
          class: "seg",
          attrs: {
            type: "button",
            "aria-pressed": String(draft.status === status),
            "data-status": status,
          },
          onClick: () => {
            for (const button of statusButtons)
              button.setAttribute("aria-pressed", String(button.dataset["status"] === status));
            set({ status });
          },
        },
        status === "draft" ? "Draft" : "Published",
      ),
    );

    const file = h("input", {
      class: "sr-only",
      attrs: {
        id: `ann-file-${n}`,
        type: "file",
        accept: PICTURE_TYPES.join(","),
        multiple: "",
      },
    });
    file.addEventListener("change", () => void this.addPictures(file.files));
    const thumbs = h(
      "div",
      { class: "ann-thumbs" },
      ...draft.pictures.map((picture, index) =>
        h(
          "figure",
          { class: "ann-thumb" },
          picture.src
            ? h("img", { attrs: { src: picture.src, alt: `Picture ${index + 1}` } })
            : h("span", { class: "note" }, "Picture"),
          h(
            "button",
            {
              class: "button quiet ann-thumb-remove",
              attrs: { type: "button", "aria-label": `Remove picture ${index + 1}` },
              onClick: () => {
                this.draft = {
                  ...this.draft,
                  pictures: this.draft.pictures.filter((_, i) => i !== index),
                };
                this.render();
              },
            },
            "Remove",
          ),
        ),
      ),
      draft.pictures.length < limits.images
        ? h(
            "label",
            { class: "button quiet ann-add-picture", attrs: { for: file.id } },
            icon("image", 18),
            h("span", {}, "Add a picture"),
          )
        : null,
    );

    const problem = h(
      "p",
      {
        class: "form-error",
        attrs: { role: "alert", ...(this.problem === null && { hidden: "" }) },
      },
      this.problem ?? "",
    );
    const save = h(
      "button",
      {
        class: "button primary",
        attrs: { type: "submit", ...(this.busy && { disabled: "" }) },
      },
      this.busy ? "Saving…" : "Save",
    );
    const cancel = h(
      "button",
      { class: "button quiet", attrs: { type: "button" }, onClick: () => this.close() },
      "Cancel",
    );
    const formActions = h(
      "div",
      {
        class: "actions ann-form-actions",
        attrs: { ...(this.confirmingGift && { hidden: "" }) },
      },
      cancel,
      save,
    );
    const giftConfirm = h(
      "div",
      { class: "confirm", attrs: { ...(!this.confirmingGift && { hidden: "" }) } },
      h(
        "p",
        { class: "confirm-question" },
        `Publish with a gift of ${count(giftOf(draft) || 0)} Shiny?`,
      ),
      h(
        "p",
        { class: "note" },
        "Every player can claim it once while this announcement is up. Claimed Shiny cannot be taken back, and the amount cannot change after the first claim.",
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            class: "button quiet",
            attrs: { type: "button" },
            onClick: () => {
              this.confirmingGift = false;
              this.render();
            },
          },
          "Go back",
        ),
        h(
          "button",
          {
            class: "button primary",
            attrs: { type: "button", ...(this.busy && { disabled: "" }) },
            onClick: () => void this.save(true),
          },
          "Publish with gift",
        ),
      ),
    );

    const form = h(
      "form",
      {
        class: "ann-form",
        attrs: {
          novalidate: "",
          "aria-label": this.editing === null ? "New announcement" : "Change announcement",
        },
      },
      h("h3", {}, this.editing === null ? "New announcement" : "Change announcement"),
      h(
        "div",
        { class: "field" },
        h("label", { attrs: { for: title.id } }, "Title"),
        title,
        titleCount,
      ),
      h(
        "div",
        { class: "field" },
        h("label", { attrs: { for: body.id } }, "Text"),
        body,
        h(
          "span",
          { class: "actions split" },
          h(
            "span",
            { class: "hint" },
            "Plain text. A blank line starts a new paragraph. https:// addresses become links.",
          ),
          bodyCount,
        ),
      ),
      h(
        "div",
        { class: "field" },
        h(
          "span",
          { class: "field-label" },
          `Pictures (up to ${limits.images}, PNG, JPEG or WebP)`,
        ),
        thumbs,
        file,
      ),
      h(
        "div",
        { class: "field ann-gift" },
        h("label", { attrs: { for: gift.id } }, "Shiny gift"),
        gift,
        h(
          "span",
          { class: "hint" },
          claims > 0
            ? `${count(claims)} claimed, so the amount cannot change.`
            : "Each player gets this once, when they press Claim. Empty: no gift.",
        ),
      ),
      h(
        "div",
        { class: "ann-times" },
        h(
          "div",
          { class: "field" },
          h("label", { attrs: { for: startsAt.id } }, "Starts"),
          startsAt,
          h("span", { class: "hint" }, "Empty: as soon as it is published"),
        ),
        h(
          "div",
          { class: "field" },
          h("label", { attrs: { for: endsAt.id } }, "Ends"),
          endsAt,
          h("span", { class: "hint" }, "Empty: until you change it"),
        ),
      ),
      h(
        "div",
        { class: "field" },
        h("span", { class: "field-label" }, "Who sees it"),
        h(
          "div",
          { class: "segmented", attrs: { role: "group", "aria-label": "Draft or published" } },
          ...statusButtons,
        ),
        h(
          "span",
          { class: "hint" },
          "A draft is only here. Published shows in the game between the start and end.",
        ),
      ),
      problem,
      giftConfirm,
      formActions,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.busy) void this.save();
    });
    drawPreview();
    return h(
      "div",
      { class: "ann-editor" },
      form,
      h("div", { class: "ann-preview-wrap" }, h("h3", {}, "How players see it"), preview),
    );
  }

  /** The game's pop-up, drawn by the game's code in the game's colours. */
  private renderPreview(): HTMLElement {
    const draft = this.draft;
    const content = announcementContent(
      draft.body.trim() || "Your text shows here.",
      draft.pictures.map((picture) => picture.src).filter((src) => src !== ""),
    );
    const gift = giftOf(draft);
    return h(
      "div",
      { class: "game-look ann-preview" },
      h(
        "section",
        { class: "ann-preview-panel", attrs: { "aria-label": "Preview" } },
        h(
          "header",
          { class: "ann-preview-titlebar" },
          h("h2", { class: "ann-preview-title" }, draft.title.trim() || "Title"),
          h("span", { class: "ann-preview-close", attrs: { "aria-hidden": "true" } }, "×"),
        ),
        h(
          "div",
          { class: "ann-preview-body" },
          content,
          gift > 0
            ? h(
                "div",
                { class: "announcement-gift" },
                giftAmount(gift),
                h("span", { class: "ann-preview-done" }, "Claim"),
              )
            : h(
                "div",
                { class: "ann-preview-foot" },
                h("span", { class: "ann-preview-done" }, "Got it"),
              ),
        ),
      ),
    );
  }
}
