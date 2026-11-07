import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";
import { mlcModelId, NOTES_MODELS } from "./llm-models";

describe("mlcModelId", () => {
  it("maps every notes model to a WebLLM prebuilt model, for both f16 and f32 GPUs", () => {
    const ids = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));
    for (const m of NOTES_MODELS) {
      for (const f16 of [true, false]) expect(ids.has(mlcModelId(m.id, f16))).toBe(true);
    }
  });

  it("uses a context window that fits our map prompt + output", () => {
    for (const m of NOTES_MODELS) {
      const rec = prebuiltAppConfig.model_list.find((x) => x.model_id === mlcModelId(m.id, true));
      expect(rec?.overrides?.context_window_size ?? 4096).toBeGreaterThanOrEqual(4096);
    }
  });
});
