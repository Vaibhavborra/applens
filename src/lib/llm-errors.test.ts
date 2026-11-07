import { describe, expect, it } from "vitest";
import { deviceLostMessage, isGpuDeviceLost } from "./llm-errors";

describe("isGpuDeviceLost", () => {
  it("recognises WebLLM's device-lost symptoms", () => {
    expect(
      isGpuDeviceLost(new Error("Device was lost. This can happen due to insufficient memory")),
    ).toBe(true);
    expect(
      isGpuDeviceLost(
        new Error("BindingError: Cannot pass deleted object as a pointer of type GrammarMatcher"),
      ),
    ).toBe(true);
    expect(isGpuDeviceLost(new Error("Object has already been disposed"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isGpuDeviceLost(new Error("Failed to fetch"))).toBe(false);
    expect(isGpuDeviceLost("QuotaExceededError")).toBe(false);
  });
});

describe("deviceLostMessage", () => {
  it("names the GPU when known", () => {
    expect(deviceLostMessage("AMD gcn-5")).toContain("Your GPU (AMD gcn-5) stopped responding");
    expect(deviceLostMessage(null)).toContain("Your GPU stopped responding");
  });
});
