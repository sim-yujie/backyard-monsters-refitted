import { SHOP_ITEMS, shopOffer } from "@/game/yard/shop";
import type { SpeedupItem } from "@/api/types";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { jobOffer } from "./buildingActions";
import { ShinyButton } from "./ShinyButton";

/**
 * The "all workers are busy" box (`client/scripts/POPUPS.as` `DisplayWorker`):
 * pressing Build, Upgrade or Fortify with no free worker offers to buy
 * another worker (the Shop's Extra Worker) or to spend Shiny to finish the
 * soonest job (the building panel's Finish, same item and price), instead of
 * only greying the button.
 */

/** The Extra Worker's store code (see `SHOP_ITEMS`). */
const WORKER_ITEM = "BEW";

/** What the box can offer right now. */
export interface WorkersBusyModel {
  /** Another worker, with the Shiny it costs; null when none is on sale (an outpost, the fifth bought). */
  readonly buyWorker: { readonly price: number; readonly blocked: string | null } | null;
  /** Finishing the job that ends soonest; null when no running job can be sped up. */
  readonly finish: {
    readonly buildingId: number;
    readonly item: SpeedupItem;
    /** Shiny; 0 for the free finish of the last five minutes. */
    readonly price: number;
    readonly blocked: string | null;
  } | null;
}

/** Reads what the box offers from the store. */
export const workersBusyModel = (store: YardStore): WorkersBusyModel => {
  const item = SHOP_ITEMS.find((one) => one.item === WORKER_ITEM);
  let buyWorker: WorkersBusyModel["buyWorker"] = null;
  if (item && (store.kind !== "outpost" || item.outposts)) {
    const { state } = shopOffer(item, store);
    if (state.kind === "buy") buyWorker = { price: state.price, blocked: state.blocked };
  }

  let finish: WorkersBusyModel["finish"] = null;
  const jobs = store
    .jobs()
    .filter((job) => job.holdsWorker && job.endsAt !== null && job.buildingId !== null);
  for (const job of jobs) {
    const building = store.building(job.buildingId!);
    const offer = building ? jobOffer(building, store)?.finish : null;
    if (!offer) continue;
    const blocked =
      offer.blocked === "credits"
        ? "Not enough Shiny."
        : offer.blocked === "paused"
          ? "Paused until the building is repaired."
          : offer.blocked === "tooShort"
            ? "Nothing left to finish."
            : null;
    finish = { buildingId: job.buildingId!, item: offer.item, price: offer.price, blocked };
    break;
  }
  return { buyWorker, finish };
};

/** What the box says above the choices. */
export const workersBusyText = (total: number): string =>
  total === 1
    ? "Your worker is busy. Get another worker, or spend Shiny to finish the job now."
    : `All ${total} of your workers are busy. Get another worker, or spend Shiny to finish the soonest job now.`;

/**
 * Opens the box over the yard. `onFreed` runs once a worker is free again (a
 * worker bought, or a job finished), so the action that was refused can go
 * ahead; the box closes first.
 */
export const openWorkersBusyBox = (binding: YardUiBinding, onFreed?: () => void): Popup => {
  const { store } = binding;
  const popup = new Popup({ title: "All workers busy", className: "workers-busy" });
  const model = workersBusyModel(store);

  const text = document.createElement("p");
  text.className = "workers-busy__text";
  text.textContent = workersBusyText(store.workers.total);
  const status = document.createElement("p");
  status.className = "workers-busy__status";
  status.setAttribute("role", "status");
  const row = document.createElement("div");
  row.className = "map-row map-row--wrap workers-busy__buttons";
  popup.body.append(text, row, status);

  const buttons: HTMLElement[] = [];
  const run = async (action: () => Promise<{ ok: true } | { ok: false; refusal: { message?: string } }>): Promise<void> => {
    const result = await action();
    if (result.ok) {
      popup.close();
      onFreed?.();
    } else {
      status.textContent = result.refusal.message || "That did not work.";
    }
  };

  if (model.buyWorker) {
    const button = new ShinyButton({
      label: "Buy a worker",
      what: "an extra worker",
      spell: formatAmount,
      onSpend: () => void run(() => store.buy(WORKER_ITEM)),
    });
    button.setPrice(model.buyWorker.price);
    button.setBlocked(model.buyWorker.blocked);
    buttons.push(button.element);
  }
  if (model.finish) {
    const { buildingId, item, price, blocked } = model.finish;
    if (item === "SP1") {
      const free = document.createElement("button");
      free.type = "button";
      free.className = "btn btn--primary";
      free.textContent = "Finish soonest job free";
      free.disabled = blocked !== null;
      free.addEventListener("click", () => void run(() => store.speedUp(buildingId, item)));
      buttons.push(free);
    } else {
      const button = new ShinyButton({
        label: "Finish soonest job",
        what: "the soonest job",
        spell: formatAmount,
        onSpend: () => void run(() => store.speedUp(buildingId, item)),
      });
      button.setPrice(price);
      button.setBlocked(blocked);
      buttons.push(button.element);
    }
  }
  row.append(...buttons);

  if (!model.buyWorker && !model.finish) {
    status.textContent = "Wait for a job to finish, or free a worker by cancelling one.";
  }

  popup.mount(binding.modal ?? document.body);
  return popup;
};
