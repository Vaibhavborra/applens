/**
 * Encode mono float PCM as a 16-bit WAV. Used as a playback fallback when the
 * browser can't play the original file (e.g. formats only ffmpeg.wasm could decode).
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  v.setUint16(32, bytesPerSample, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataSize, true);

  const samples = new Int16Array(buf, 44, pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Blob([buf], { type: "audio/wav" });
}
