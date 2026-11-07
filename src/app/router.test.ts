import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("parses home and lecture routes", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("/lecture/0b1c-22ff")).toEqual({ name: "lecture", id: "0b1c-22ff" });
    expect(parseRoute("/lecture/abc/")).toEqual({ name: "lecture", id: "abc" });
  });

  it("rejects unknown paths", () => {
    expect(parseRoute("/lecture/")).toEqual({ name: "not-found" });
    expect(parseRoute("/lecture/a/b")).toEqual({ name: "not-found" });
    expect(parseRoute("/nope")).toEqual({ name: "not-found" });
  });
});
