import z from "zod";

/**
 * An optional true/false that a form-encoded body sends as "true" or "false"
 * (a JSON body's real booleans pass straight through). `z.boolean()` alone
 * refuses the form's strings with a 400.
 */
export const formBoolean = z.preprocess(
  (input) => (input === "true" ? true : input === "false" ? false : input),
  z.boolean().optional()
);
