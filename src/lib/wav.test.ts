import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

describe("encodeWav", () => {
  it("writes a valid 16-bit mono PCM header and clamped samples", async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 16000);
    expect(blob.type).toBe("audio/wav");
    const v = new DataView(await blob.arrayBuffer());
    const str = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));

    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(36, 4)).toBe("data");
    expect(v.getUint32(4, true)).toBe(36 + 12);
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(12);

    const samples = Array.from({ length: 6 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});
