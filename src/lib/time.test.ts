import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./time";

describe("formatTimestamp", () => {
  it("formats sub-hour times as m:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65.9)).toBe("1:05");
    expect(formatTimestamp(3599)).toBe("59:59");
  });

  it("formats hour+ times as h:mm:ss", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("clamps negatives to zero", () => {
    expect(formatTimestamp(-4)).toBe("0:00");
  });
});
