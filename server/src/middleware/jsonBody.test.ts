import { describe, expect, test } from "bun:test";
import { LayoutPayloadSchema, SaveLayoutSchema } from "../schemas/YardPlannerSchemas.js";
import { JSON_BODY_TYPES, normaliseJsonBody } from "./jsonBody.js";

describe("normaliseJsonBody", () => {
  test("leaves a form-shaped body untouched", () => {
    const form = { name: "Main", data: '{"version":2}', startUpgrades: "1" };

    // Same object back, not a copy: nothing in a form body ever needs converting.
    expect(normaliseJsonBody(form)).toBe(form);
  });

  test("stringifies an object field into its form equivalent", () => {
    const payload = { version: 2, expansion: 0, nodes: [{ id: 1, t: 4, x: 10, y: 12 }] };

    const normalised = normaliseJsonBody({ name: "Main", data: payload });

    expect(normalised).toEqual({ name: "Main", data: JSON.stringify(payload) });
  });

  test("stringifies an array field", () => {
    expect(normaliseJsonBody({ ids: [7, 9], level: 3 })).toEqual({
      ids: "[7,9]",
      level: 3,
    });
  });

  test("leaves scalars as sent", () => {
    const body = {
      level: 3,
      startUpgrades: 0,
      shinyLocked: false,
      name: "Main",
      missing: null,
      absent: undefined,
    };

    expect(normaliseJsonBody(body)).toEqual(body);
  });

  test("leaves a field the client already stringified as a string", () => {
    const data = '{"version":2,"expansion":0,"nodes":[]}';

    expect(normaliseJsonBody({ data, ids: [1] })).toEqual({ data, ids: "[1]" });
  });

  test("converts only the top level, the depth a form body can reach", () => {
    const normalised = normaliseJsonBody({ a: { b: { c: 1 } } }) as Record<string, unknown>;

    expect(normalised["a"]).toBe('{"b":{"c":1}}');
  });

  test("passes through anything that is not a plain object", () => {
    expect(normaliseJsonBody(undefined)).toBeUndefined();
    expect(normaliseJsonBody(null)).toBeNull();
    expect(normaliseJsonBody("raw")).toBe("raw");
    expect(normaliseJsonBody([1, 2])).toEqual([1, 2]);
    expect(normaliseJsonBody({})).toEqual({});
  });

  test("a JSON planner body parses exactly like the form one", () => {
    const payload = {
      version: 2 as const,
      expansion: 3,
      nodes: [{ id: 1, t: 4, x: 10, y: 12, plan: { level: 2, order: 0 } }],
    };

    const fromJson = SaveLayoutSchema.parse(
      normaliseJsonBody({ name: "Main", data: payload })
    );
    const fromForm = SaveLayoutSchema.parse({ name: "Main", data: JSON.stringify(payload) });

    expect(fromJson).toEqual(fromForm);
    expect(LayoutPayloadSchema.parse(JSON.parse(fromJson.data))).toEqual(payload);
  });
});

describe("JSON_BODY_TYPES", () => {
  test("matches the types koa-bodyparser parses as JSON", () => {
    expect(JSON_BODY_TYPES).toContain("application/json");
    expect(JSON_BODY_TYPES).toEqual([
      "application/json",
      "application/json-patch+json",
      "application/vnd.api+json",
      "application/csp-report",
      "application/scim+json",
    ]);
  });
});
