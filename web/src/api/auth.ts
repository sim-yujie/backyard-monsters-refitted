import { SESSION_STORAGE_KEY } from "@/config";
import { post, setAuthToken } from "./http";
import { SessionType, type LoginRequest, type LoginResponse, type Session } from "./types";

/**
 * Login. Route and fields from docs/server-api.md §Auth:
 * POST /api/:apiVersion/player/getinfo, validated by UserLoginSchema — either
 * `email` + `password`, or `token` for re-login with a JWT the server already
 * minted. `sessionType` defaults to "game"; a game session and a launcher
 * session are tracked separately, so logging in here does not evict a website
 * session. No field on this route is a JSON string.
 */
const LOGIN_PATH = "/api/:apiVersion/player/getinfo";

let current: Session | null = null;

/**
 * The map bookmark blob from the last successful login.
 *
 * There is no endpoint that reads bookmarks back: `savebookmarks` only writes,
 * and the list is returned on the login response and nowhere else. Every route
 * into the map runs through a login or a token re-login first (BootScene), so
 * holding it here is enough and nothing has to re-authenticate to read it.
 */
let lastBookmarks: unknown = undefined;

/** The active session, or null when signed out. */
export const getSession = (): Session | null => current;

/** The raw bookmark blob the server last sent. Decode it with api/bookmarks.ts. */
export const getStoredBookmarks = (): unknown => lastBookmarks;

const remember = (session: Session): Session => {
  current = session;
  setAuthToken(session.token);
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing or a full quota. The in-memory session still works.
  }
  return session;
};

const toSession = (response: LoginResponse, sessionType: SessionType): Session => ({
  token: response.token,
  userId: response.userId,
  username: response.username ?? null,
  sessionType,
});

/** Signs in with an email and password. */
export const login = async (
  email: string,
  password: string,
  sessionType: SessionType = SessionType.GAME,
): Promise<Session> => {
  const body: LoginRequest = { email, password, sessionType };
  const response = await post<LoginResponse>(LOGIN_PATH, { ...body });
  lastBookmarks = response.bookmarks;
  return remember(toSession(response, sessionType));
};

/**
 * Re-authenticates with a stored token.
 *
 * The server keeps exactly one valid token per account and session type in
 * Redis, so a structurally valid but superseded JWT is rejected. That makes
 * this the only safe way to check a restored session: the token has to be
 * handed back to the login route, not merely decoded here.
 */
export const loginWithToken = async (
  token: string,
  sessionType: SessionType = SessionType.GAME,
): Promise<Session> => {
  const body: LoginRequest = { token, sessionType };
  const response = await post<LoginResponse>(LOGIN_PATH, { ...body });
  lastBookmarks = response.bookmarks;
  // The route mints a fresh token, so prefer the new one over the one sent.
  return remember(toSession(response, sessionType));
};

/** Reads a session off localStorage without contacting the server. */
export const restoreStoredSession = (): Session | null => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || typeof parsed.userId !== "number") return null;

    current = {
      token: parsed.token,
      userId: parsed.userId,
      username: parsed.username ?? null,
      sessionType: parsed.sessionType ?? SessionType.GAME,
    };
    setAuthToken(current.token);
    return current;
  } catch {
    return null;
  }
};

/**
 * Clears the session locally.
 *
 * There is no server-side logout: the Redis token entry is only replaced by a
 * new login or dropped when the JWT expires. Forgetting the token here is the
 * whole of what a client can do.
 */
export const logout = (): void => {
  current = null;
  lastBookmarks = undefined;
  setAuthToken(null);
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
};
