import { alertConfig, type AlertConfig } from "../../config/AlertConfig.js";

/**
 * Sends one Telegram message to the owner through the Bot API
 * (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; docs/alerts.md).
 *
 * Plain text, so a player's words in a bug report can never become markup;
 * Telegram turns the dashboard address into a link by itself. The bot token is
 * part of the request address, so it is never put in an error or a log line.
 */

export const TELEGRAM_API = "https://api.telegram.org";

/** Telegram's own limit on one message. */
export const TELEGRAM_MAX_LENGTH = 4096;

/** A cut-down `fetch`, so tests can pass a fake one. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type TelegramResult = { readonly sent: true } | { readonly sent: false; readonly reason: string };

/** Sends `text` and says whether Telegram took it; never throws. */
export type SendTelegram = (text: string) => Promise<TelegramResult>;

/** What Telegram says about a failed call, without the token. */
const describeFailure = async (response: { status: number; text(): Promise<string> }): Promise<string> => {
  let description = "";
  try {
    const body = JSON.parse(await response.text()) as { description?: unknown };
    if (typeof body.description === "string") description = `: ${body.description.slice(0, 200)}`;
  } catch {
    // Not JSON; the status says enough.
  }
  return `Telegram answered ${response.status}${description}`;
};

/**
 * Sends one message.
 *
 * @param {string} text - The message; cut to Telegram's limit.
 * @param {object} [options] - The settings and `fetch` to use (tests pass fakes).
 * @returns {Promise<TelegramResult>} `sent: false` with a reason when alerts are
 *   off or the call failed.
 */
export const sendTelegram = async (
  text: string,
  { config = alertConfig(), fetch: doFetch = fetch as unknown as FetchLike }: { config?: AlertConfig; fetch?: FetchLike } = {}
): Promise<TelegramResult> => {
  if (!config.telegram) return { sent: false, reason: "Telegram alerts are off (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID unset)" };
  const { token, chatId } = config.telegram;
  try {
    const response = await doFetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.length > TELEGRAM_MAX_LENGTH ? `${text.slice(0, TELEGRAM_MAX_LENGTH - 1)}…` : text,
        disable_web_page_preview: true,
      }),
    });
    return response.ok ? { sent: true } : { sent: false, reason: await describeFailure(response) };
  } catch (err) {
    // A network error's message can carry the address, and so the token.
    const message = err instanceof Error ? err.message : String(err);
    return { sent: false, reason: `Telegram could not be reached: ${message.split(token).join("<token>")}` };
  }
};

/** One chat the bot has heard from, for finding TELEGRAM_CHAT_ID. */
export interface TelegramChat {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

/**
 * Lists the chats that have messaged the bot lately (Telegram's `getUpdates`),
 * so the owner can find their chat id: they send the bot any message first.
 *
 * @throws {Error} When the token is unset or Telegram refuses (the token is never in the message).
 */
export const recentTelegramChats = async (
  token: string,
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<TelegramChat[]> => {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  let response;
  try {
    response = await doFetch(`${TELEGRAM_API}/bot${token}/getUpdates`, { method: "POST", headers: {}, body: "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Telegram could not be reached: ${message.split(token).join("<token>")}`);
  }
  if (!response.ok) throw new Error(await describeFailure(response));
  const body = JSON.parse(await response.text()) as { result?: Array<Record<string, any>> };
  const chats = new Map<string, TelegramChat>();
  for (const update of body.result ?? []) {
    const chat = (update.message ?? update.channel_post ?? update.my_chat_member)?.chat;
    if (!chat || chat.id === undefined) continue;
    const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "";
    chats.set(String(chat.id), { id: String(chat.id), kind: String(chat.type ?? "?"), name: String(name) });
  }
  return [...chats.values()];
};
