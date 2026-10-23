/**
 * The old Flash Inferno routes: closed until the new Inferno ships.
 *
 * The web game has no Inferno yet, and the routes the Flash client used for it
 * trust what the client sends, for the Inferno yard and the main yard alike.
 * So every one of them is refused while this is `false`:
 *
 * - `/base/load` and `/api/:v/bm/base/load` in any Inferno mode (`ibuild`,
 *   `iattack`, `iwmattack`, `idescent`, `iview`, `ihelp`, `iwmview`);
 * - `/api/:v/bm/base/updatesaved` in `iview` and `iattack`;
 * - `/api/:v/bm/base/save` (the Flash save route, `infernoSave.ts`), whatever row it names;
 * - `/base/save` on an Inferno yard or an Inferno tribe row;
 * - `/api/:v/bm/base/infernomonsters`;
 * - `/api/:v/bm/neighbours/get` with `type: "inferno"`.
 *
 * A code constant, not an environment variable, so no server can open them by
 * a stray setting: the new Inferno (beta.5) turns this on in the same change
 * that puts server checks on those routes. Refusals answer `403` with
 * `reason: "infernoClosed"` (`services/inferno/infernoGate.ts`).
 */
export const infernoConfig = {
  /** True lets the old Inferno routes run. Off until the new Inferno is built. */
  legacyRoutesOpen: false,
};
