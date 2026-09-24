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
 *    takeoverCellErr, truceActiveErr, mapRoomDisabledErr). A few controllers
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

  constructor(
    message: string,
    init: {
      status: number;
      serverStatus?: number;
      code?: string | number;
      details?: ApiErrorDetails;
      body?: unknown;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.serverStatus = init.serverStatus ?? init.status;
    this.code = init.code;
    this.details = init.details;
    this.body = init.body;
  }

  /** True when the caller should send the player back to the login screen. */
  get isAuthFailure(): boolean {
    return this.serverStatus === 401 || this.serverStatus === 403;
  }
}

/** Thrown when the server could not be reached at all. */
export class NetworkError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "NetworkError";
  }
}

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

const buildHeaders = (contentType?: string): Headers => {
  const headers = new Headers({ Accept: "application/json" });
  if (contentType) headers.set("Content-Type", contentType);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
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
    const message =
      (typeof code === "string" && code) ||
      details?.message ||
      details?.error ||
      (typeof body === "string" && body) ||
      `Request to ${response.url} failed with status ${response.status}`;

    throw new ApiError(message, {
      status: response.status,
      ...(details?.status !== undefined ? { serverStatus: details.status } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
      body,
    });
  }

  return envelope as T;
};

export interface RequestOptions {
  signal?: AbortSignal;
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
  const search = options.query ? encodeForm(options.query) : "";
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
      headers: buildHeaders(body?.contentType),
      ...(body ? { body: body.payload } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw new NetworkError(`Could not reach ${url}`, cause);
  }

  return unwrap<T>(response, await readBody(response));
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
