import type { FilterQuery } from "@mikro-orm/core";

import type { User } from "../../database/models/user.model.js";

/**
 * A filter matching the account that holds this username, whatever its case
 * (issue #213): "Bob" and "bob" read as the same player on the map and in
 * mail, so one of them may not be taken while the other exists.
 *
 * This check gives the friendly answer; the unique index on lower(username)
 * (migration 20261006, issue #216) catches two requests that race past it.
 * An underscore is a LIKE wildcard and is escaped; the other
 * characters a username may hold (letters and digits) match only themselves.
 *
 * @param {string} username - A username that passed the account rules
 * @returns {FilterQuery<User>} The filter for `findOne`
 */
export const usernameMatch = (username: string): FilterQuery<User> => ({
  username: { $ilike: username.replace(/[\\%_]/g, (character) => `\\${character}`) },
});

/**
 * Whether two usernames name the same account.
 *
 * @param {string} a - One username
 * @param {string} b - The other
 * @returns {boolean} True when they differ only by case
 */
export const sameUsername = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
