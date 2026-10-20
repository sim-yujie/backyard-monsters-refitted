// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPhoneLayout, PHONE_LAYOUT_QUERY } from "./phoneLayout";

describe("isPhoneLayout", () => {
  const original = window.matchMedia;

  afterEach(() => {
    window.matchMedia = original;
  });

  const answer = (matches: boolean) => {
    const query = vi.fn((media: string) => ({ matches, media }) as MediaQueryList);
    window.matchMedia = query;
    return query;
  };

  it("asks for the stylesheets' phone layout: upright by width, sideways by height", () => {
    const query = answer(true);
    expect(isPhoneLayout()).toBe(true);
    expect(query).toHaveBeenCalledWith(PHONE_LAYOUT_QUERY);
    expect(PHONE_LAYOUT_QUERY).toBe("(width <= 620px), (height <= 500px)");
  });

  it("is false on a wide screen, and where nothing can tell", () => {
    answer(false);
    expect(isPhoneLayout()).toBe(false);
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(isPhoneLayout()).toBe(false);
  });
});
