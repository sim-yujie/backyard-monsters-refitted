import { describe, expect, it } from "vitest";
import { GroundData } from "./GroundData";

describe("GroundData", () => {
  it("uploads its bytes as data, not premultiplied (heights and features reach the shader whole)", () => {
    const data = new GroundData(4, 4);
    expect(data.source.alphaMode).toBe("no-premultiply-alpha");
  });
});
