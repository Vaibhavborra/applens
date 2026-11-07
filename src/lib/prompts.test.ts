import { describe, expect, it } from "vitest";
import { mapSchema, minBullets, reducePrompt, reduceSchema } from "./prompts";

describe("map schema", () => {
  it("scales the bullet minimum with chunk duration, within 3–10", () => {
    expect(minBullets({ start: 0, end: 30 })).toBe(3);
    expect(minBullets({ start: 0, end: 240 })).toBe(8);
    expect(minBullets({ start: 0, end: 3600 })).toBe(10);
  });

  it("puts the minimums in the grammar", () => {
    const s = JSON.parse(mapSchema({ start: 0, end: 180 }));
    expect(s.properties.bullets.minItems).toBe(6);
    expect(s.properties.terms.minItems).toBe(1);
    expect(s.properties.flashcards.minItems).toBe(2);
  });
});

describe("reduce", () => {
  const part = (title: string) => ({
    title,
    bullets: [{ text: "x", start: 0 }],
    terms: [],
    flashcards: [],
    fallback: false,
  });

  it("only asks for sections when there are enough parts", () => {
    expect(JSON.parse(reduceSchema(false)).properties.sections).toBeUndefined();
    expect(JSON.parse(reduceSchema(true)).required).toContain("sections");
    expect(reducePrompt([part("a"), part("b")], 3)[1]!.content).not.toContain('"sections"');
    expect(reducePrompt([part("a"), part("b"), part("c"), part("d")], 3)[1]!.content).toContain(
      "part numbers 1 to 4",
    );
  });
});
