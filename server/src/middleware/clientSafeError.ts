import type { Context, Next } from "koa";
import { logger } from "../utils/logger.js";
import { Status } from "../enums/StatusCodes.js";
import { Env } from "../enums/Env.js";

interface ConstructorParams {
  status: number;
  data: object;
  internalInfo?: Error;
  message: string;
  isClientFriendly?: boolean;
}

/**
 * Error which is marked and formatted to be safe for the client
 * Removes internal details while logging them for debugging on our end
 */
export class ClientSafeError extends Error {
  status: number;
  data: object;
  internalInfo?: Error;
  error: string;
  isClientFriendly: boolean;

  constructor({
    message = "Something went wrong, please contact support.",
    status = Status.INTERNAL_SERVER_ERROR,
    data = {},
    internalInfo,
    isClientFriendly: isNiceError = false,
  }: ConstructorParams) {
    super(message);
    this.name = "ClientSafeError";
    this.status = status;
    this.data = data;
    this.internalInfo = internalInfo;
    this.error = message;
    this.isClientFriendly = isNiceError;
  }

  /**
   * Create the json to return safely to client.
   *
   * The internal error's stack (file paths, library versions) goes along only
   * off production, to help debugging; a production server logs it and sends
   * nothing (issue #213).
   */
  toSafeJson() {
    const responseBody = {
      error: undefined as string | undefined,
      status: this.status,
      data: this.data,
      internalInfo: process.env.ENV === Env.PROD ? undefined : this.internalInfo?.stack,
      message: this.message,
    };

    if (!this.isClientFriendly) responseBody.error = this.message;

    return responseBody;
  }
}

/**
 * Middleware to intercept errors and hide them from the user unless they are specifically thrown as ClientSafeErrors.
 *
 * @param {Context} ctx - The Koa context object.
 * @param {Next} next - The Koa next middleware function.
 */
export const ErrorInterceptor = async (ctx: Context, next: Next) => {
  try {
    await next();
  } catch (err) {
    // Check if the error is client safe
    const isSafe = err instanceof ClientSafeError;
    let clientError = isSafe
      ? err
      : new ClientSafeError({
          message: "Something went wrong, please contact support.",
          status: Status.INTERNAL_SERVER_ERROR,
          data: {},
          internalInfo: err instanceof Error ? err : undefined,
          isClientFriendly: true,
        });
    const errorObj = clientError.toSafeJson();

    if (!isSafe) {
      logger.error("Unhandled error on {method} {path}: {error}", {
        method: ctx.method,
        path: ctx.path,
        error: err,
      });
    }

    console.error(
      `ErrorInterceptor error: ${errorObj.message} | status: ${errorObj.status}`
    );

    // Put me in jail for my sins - this is bad to accomdate for the client
    ctx.status = errorObj.error ? Status.OK : errorObj.status;
    ctx.body = { error: errorObj.message, errorDetails: errorObj };
  }
};
