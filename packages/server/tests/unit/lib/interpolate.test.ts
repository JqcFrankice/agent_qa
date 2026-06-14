import { describe, expect, it } from "vitest";
import { interpolate } from "../../../src/lib/interpolate.js";

describe("interpolate", () => {
  it("replaces single placeholder", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("replaces multiple placeholders", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "x", b: "y" })).toBe("x and y");
  });

  it("preserves placeholder when value is missing", () => {
    expect(interpolate("hello {{name}}", {})).toBe("hello {{name}}");
  });

  it("supports content before and after placeholders", () => {
    expect(interpolate("prefix {{x}} middle {{y}} suffix", { x: "1", y: "2" }))
      .toBe("prefix 1 middle 2 suffix");
  });

  it("replaces same placeholder multiple times", () => {
    expect(interpolate("{{n}}-{{n}}-{{n}}", { n: "k" })).toBe("k-k-k");
  });

  it("does not match other syntaxes", () => {
    expect(interpolate("{x} ${y} {{ z }}", { x: "1", y: "2", z: "3" }))
      .toBe("{x} ${y} {{ z }}");
  });
});
