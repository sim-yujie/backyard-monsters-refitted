import { API_VERSION, SERVER_URL } from "@/config";
import type { ApiEnvelope, ApiErrorDetails } from "./types";

/**
 * A request the server rejected.
 *
 * Both failure channels land here, because the server has two:
 *
 * 1. A real HTTP error status.
 * 2. HTTP 200 with a non-zero `error` field in the body. The global
 *    ErrorInterceptor rewrites any ClientSafeError built with
 *    `isClientFriendly: false` to status 200 so the old Flash client would not
 *    choke on it (baseUnderAttackErr, baseProtectedErr, userOnlineErr,
 *    truceActiveErr, mapRoomDisabledErr). A few controllers
 *    also return `error: 1` on a soft failure. So the body, not the status, is
 *    what decides success.
 */
export class ApiError extends Error {
  /** HTTP status as sent. 200 for the rewritten "client friendly" errors. */
  readonly status: number;
  /** The status the server meant, from `errorDetails.status` when present. */
  readonly serverStatus: number;
  /** Raw `error` field: a message string, or a non-zero code. */
  readonly code: string | number | undefined;
  readonly details: ApiErrorDetails | undefined;
  readonly body: unknown;
  /** The address asked, for the console and error reports; never in `message`, which players read. */
  readonly url: string | undefined;

  constructor(
    message: string,
    init: {
      status: number;
      serverStatus?: number;
      code?: string | number;
      details?: ApiErrorDetails;
      body?: unknown;
      url?: string;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.serverStatus = init.serverStatus ?? init.status;
    this.code = init.code;
    this.details = init.details;
    this.body = init.body;
    this.url = init.url;
  }

  /** True when the caller should send the player back to the login screen. */
  get isAuthFailure(): boolean {
    return !this.shinyLocked && (this.serverStatus === 401 || this.serverStatus === 403);
  }

  /**
   * Shiny Lock refused a Shiny spend. The server answers 403, but the player is
   * still signed in: the message says how to turn the lock off, nothing more.
   */
  get shinyLocked(): boolean {
    return (this.details?.data as { reason?: unknown } | undefined)?.reason === "shinyLocked";
  }
}

/** Thrown when the server could not be reached at all. */
export class NetworkError extends Error {
  /** The address asked, for the console and error reports; never in `message`, which players read. */
  readonly url: string | undefined;

  constructor(message: string, cause: unknown, url?: string) {
    super(message, { cause });
    this.name = "NetworkError";
    this.url = url;
  }
}

/** A failed request's address, for error reports and the bug report's error list; "" for anything else. */
export const requestUrlOf = (error: unknown): string =>
  (error instanceof ApiError || error instanceof NetworkError) && error.url ? error.url : "";

/** A form field value. Objects and arrays must be JSON-stringified by the caller. */
export type FormValue = string | number | boolean | undefined | null;
export type FormBody = Record<string, FormValue>;

/**
 * A native JSON body, where a field holding structure is passed as the object
 * or array it is, not as a string. See {@link send}'s `json` option.
 */
export type JsonBody = Record<string, unknown>;

let authToken: string | null = null;

/** Sets the Bearer token attached to every subsequent request. */
export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

export const getAuthToken = (): string | null => authToken;

type AnswerListener = (envelope: ApiEnvelope) => void;
const answerListeners = new Set<AnswerListener>();

/**
 * Hears every successful answer, whatever sent it: a real game action's
 * answer carries `lastAction` (#275), which the "Stay protected?" prompt
 * measures from. Returns the unsubscribe.
 */
export const onAnswer = (listener: AnswerListener): (() => void) => {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
};

type RefusalListener = (error: ApiError) => void;
const refusalListeners = new Set<RefusalListener>();

/**
 * Hears every refusal the server sends, whatever asked: the maintenance
 * switch's cut-off refuses every request at once, and the game signs the
 * player out on the first one (`app/maintenanceWatch.ts`). The caller still
 * gets the error. Returns the unsubscribe.
 */
export const onRefusal = (listener: RefusalListener): (() => void) => {
  refusalListeners.add(listener);
  return () => {
    refusalListeners.delete(listener);
  };
};

/** Expands `:apiVersion` in a path template and prefixes the server origin. */
export const apiUrl = (path: string): string =>
  `${SERVER_URL}${path.replace(":apiVersion", encodeURIComponent(API_VERSION))}`;

/**
 * Encodes a body as application/x-www-form-urlencoded.
 *
 * Why form encoding is still the default: the controllers were written for the
 * Flash client's URLVariables payloads and read individual string fields off
 * the body. Fields that hold structure — `resources`, `buildingdata`,
 * `attackData`, `attackcost`, `monsters`, `bookmarks`, `champion`, `purchase`
 * and friends — are JSON-stringified into a single form field and the zod
 * schemas run `z.string().transform(JSON.parse)` over them. Existing callers
 * stringify those themselves and keep working unchanged.
 *
 * The server now also accepts a native JSON body and does that stringifying at
 * the edge (`server/src/middleware/jsonBody.ts`, issue #28), so a new call can
 * pass structure as structure — see {@link postJson}.
 *
 * Undefined and null values are dropped rather than sent as the strings
 * "undefined"/"null", which several optional zod fields would then reject.
 */
export const encodeForm = (body: FormBody): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  return params.toString();
};

const buildHeaders = (contentType?: string, token: string | null = authToken): Headers => {
  const headers = new Headers({ Accept: "application/json" });
  if (contentType) headers.set("Content-Type", contentType);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
};

/** Reads the body as JSON, tolerating an empty or non-JSON response. */
const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * What a player reads when a failed answer gives no words of its own (beta 9):
 * the server down or a proxy's error page. Many windows show an ApiError's
 * message as it is (the Repeat attack sheet showed "Request to
 * http://…/worldmapv2/autoattack failed with status 500"), so it never names
 * the address; that goes to the console and {@link ApiError.url}.
 */
export const SERVER_TROUBLE_TEXT = "Server problem. Try again in a moment.";

/** A {@link NetworkError}'s words: the server could not be reached at all. */
export const NO_REACH_TEXT = "Could not reach the server. Check your connection.";

/** A plain-text answer short enough to show: not a web page, no address in it. */
const readableText = (body: unknown): string => {
  if (typeof body !== "string") return "";
  const text = body.trim();
  return text.length <= 200 && !/[<>]|https?:\/\/|\/api\//i.test(text) ? text : "";
};

/**
 * Turns a response into either the parsed envelope or an ApiError.
 *
 * Success needs both a 2xx status and an `error` field that is absent or 0.
 */
const unwrap = <T extends ApiEnvelope>(response: Response, body: unknown): T => {
  const envelope = (typeof body === "object" && body !== null ? body : {}) as ApiEnvelope;
  const details = envelope["errorDetails"] as ApiErrorDetails | undefined;
  const code = envelope.error;

  const failedByStatus = !response.ok;
  const failedByEnvelope = code !== undefined && code !== 0 && code !== "0";

  if (failedByStatus || failedByEnvelope) {
    const words = (typeof code === "string" && code) || details?.message || details?.error || readableText(body);
    if (!words) console.warn(`Request to ${response.url} failed with status ${response.status}`);

    throw new ApiError(words || SERVER_TROUBLE_TEXT, {
      status: response.status,
      ...(details?.status !== undefined ? { serverStatus: details.status } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
      body,
      url: response.url,
    });
  }

  return envelope as T;
};

export interface RequestOptions {
  signal?: AbortSignal;
  /**
   * Lets the request outlive the page (`fetch`'s `keepalive`), for the one
   * that must still reach the server as the tab closes or reloads (issue
   * #138). The browser caps such bodies at 64 KB in total.
   */
  keepalive?: boolean;
  /**
   * The Bearer token to send instead of the current one. A request sent on
   * the way out of a scene may go after a sign-out has already cleared it.
   */
  token?: string | null;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface SendOptions extends RequestOptions {
  /** Form-encoded into the body. Omit for a request that carries none. */
  form?: FormBody;
  /**
   * Sent as an `application/json` body instead of a form one. Nested objects
   * and arrays are sent as they are: the server re-stringifies its top-level
   * fields before the schemas see them, so both encodings reach a controller
   * as the same flat body. Ignored when `form` is set.
   */
  json?: JsonBody;
  /** Form-encoded onto the query string. */
  query?: FormBody;
}

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded;charset=UTF-8";
const JSON_CONTENT_TYPE = "application/json";

/** The query parameter a request names this page's build in (`server/src/middleware/pageBuild.ts`). */
export const PAGE_BUILD_PARAM = "pb";

let pageBuild: string | null = null;

/**
 * This page's build: the hash in the name of the entry script it runs
 * (`/static/index-<hash>.js`, as `app/updateCheck.ts` reads it), or null in
 * a development build or a test, which have none. Sent with every request so
 * the server's request log can count tabs still on an old page after a
 * release (beta 10, owner's pick B+).
 */
export const pageBuildId = (doc: Document | undefined = globalThis.document): string | null => {
  if (pageBuild !== null) return pageBuild;
  try {
    for (const script of doc?.querySelectorAll<HTMLScriptElement>("script[type=module][src]") ?? []) {
      const hash = (script.getAttribute("src") ?? "").match(/\/static\/index-([\w-]{1,40})\.js/)?.[1];
      if (hash) return (pageBuild = hash);
    }
  } catch {
    // No document to read (a worker): no build to name.
  }
  return null;
};

/** `pb=<build>` for the query string, or "" when the page has no build id. */
const pageBuildParam = (): string => {
  const build = pageBuildId();
  return build ? `${PAGE_BUILD_PARAM}=${encodeURIComponent(build)}` : "";
};

/**
 * One request, one envelope.
 *
 * Every route on this server speaks the same two dialects — form-encoded in,
 * `{ error }` envelope out — so the method is the only thing that varies and
 * `post`, `get` and the planner's PUT and DELETE are all thin wrappers. Keeping
 * the failure handling in one place is the point: both of the server's error
 * channels are decided in `unwrap`, and a second copy of that logic would drift.
 */
export const send = async <T extends ApiEnvelope>(
  method: HttpMethod,
  path: string,
  options: SendOptions = {},
): Promise<T> => {
  // The tribe yard editor answers its yard's routes in the browser, so they
  // never reach the player's own yard on the server (`game/tribeEditor`).
  const answered = localRoute?.(method, path, options.form ?? options.json ?? options.query ?? {});
  if (answered) return (await answered) as T;

  const search = [options.query ? encodeForm(options.query) : "", pageBuildParam()].filter(Boolean).join("&");
  const url = `${apiUrl(path)}${search ? `?${search}` : ""}`;

  // `form` wins if a caller somehow passes both, so the encoding a call site
  // already has can never be changed out from under it by a second option.
  const body =
    options.form !== undefined
      ? { contentType: FORM_CONTENT_TYPE, payload: encodeForm(options.form) }
      : options.json !== undefined
        ? { contentType: JSON_CONTENT_TYPE, payload: JSON.stringify(options.json) }
        : undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders(body?.contentType, options.token === undefined ? authToken : options.token),
      ...(body ? { body: body.payload } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
  } catch (cause) {
    // Many windows show the message as it is: the address stays out of it (beta 9).
    throw new NetworkError(NO_REACH_TEXT, cause, url);
  }

  let envelope: T;
  try {
    envelope = unwrap<T>(response, await readBody(response));
  } catch (caught) {
    if (caught instanceof ApiError) {
      for (const listener of [...refusalListeners]) {
        try {
          listener(caught);
        } catch {
          // A listener's mistake is not the request's.
        }
      }
    }
    throw caught;
  }
  for (const listener of [...answerListeners]) {
    try {
      listener(envelope);
    } catch {
      // A listener's mistake is not the request's.
    }
  }
  return envelope;
};

/**
 * A stand-in that answers some requests in the browser instead of the server:
 * a promise for the answer (or a rejection, as the server's refusal would be),
 * or undefined to let the request go out as usual. Only the tribe yard editor
 * sets one (`game/tribeEditor/tribeEditSession.ts`), while its yard is open.
 */
export type LocalRoute = (
  method: HttpMethod,
  path: string,
  body: FormBody | JsonBody,
) => Promise<ApiEnvelope> | undefined;

let localRoute: LocalRoute | null = null;

/** Sets (or, with null, clears) the {@link LocalRoute}. */
export const setLocalRoute = (route: LocalRoute | null): void => {
  localRoute = route;
};

/** POSTs a form-encoded body and unwraps the JSON envelope. */
export const post = <T extends ApiEnvelope>(
  path: string,
  body: FormBody = {},
  options: RequestOptions = {},
): Promise<T> => send<T>("POST", path, { ...options, form: body });

/**
 * POSTs a native `application/json` body and unwraps the JSON envelope.
 *
 * The one thing that differs from {@link post}: a field holding structure is
 * passed as the object or array it is, rather than pre-stringified. Numeric
 * fields may be sent as numbers, but the few ids the server declares as strings
 * (`baseid`, `basesaveid`, `attackid`) must still be sent as strings.
 */
export const postJson = <T extends ApiEnvelope>(
  path: string,
  body: JsonBody = {},
  options: RequestOptions = {},
): Promise<T> => send<T>("POST", path, { ...options, json: body });

/** GETs a path with an optional query string and unwraps the JSON envelope. */
export const get = <T extends ApiEnvelope>(
  path: string,
  query: FormBody = {},
  options: RequestOptions = {},
): Promise<T> => send<T>("GET", path, { ...options, query });
