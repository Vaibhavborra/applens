import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("passes messages through when online", () => {
    expect(errorMessage(new Error("Failed to fetch"), true)).toBe("Failed to fetch");
    expect(errorMessage("boom", true)).toBe("boom");
  });

  it("explains failed downloads when offline", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), false)).toMatch(/You're offline/);
    expect(errorMessage(new Error("Could not locate file: model.onnx"), false)).toMatch(/offline/);
    expect(errorMessage(new Error("Out of memory"), false)).toBe("Out of memory");
  });
});
