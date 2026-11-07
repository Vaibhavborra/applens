import { resampleLinear } from "./pcm";

/**
 * Collects ~4K-sample blocks on the audio thread and posts them to the main
 * thread. Inlined as a Blob URL so it needs no separate build entry.
 */
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("lna-capture", Capture);
`;

export interface Mic {
  /** Stop capturing and release the microphone. */
  stop(): void;
  /** The microphone's name, if the browser shares it. */
  label: string;
}

export class MicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicError";
  }
}

function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow it from the icon in the address bar, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Plug one in and try again.";
  if (name === "NotReadableError")
    return "The microphone is in use by another app, or the system blocked it.";
  return `Couldn't start the microphone: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Capture mono microphone audio at `sampleRate` (16 kHz for Whisper). `onPcm`
 * receives blocks of ~0.25 s. The context runs at 16 kHz where the browser
 * allows it (Chrome resamples the mic for us); otherwise we resample.
 */
export async function startMic(
  sampleRate: number,
  onPcm: (pcm: Float32Array) => void,
  /** The microphone went away (unplugged, or permission revoked). */
  onEnded?: () => void,
): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError(
      "This browser can't record from a microphone (it needs HTTPS or localhost).",
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    throw new MicError(micErrorMessage(e));
  }

  let ctx = new AudioContext({ sampleRate });
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    // Firefox can't connect a mic to a context at a different rate.
    await ctx.close();
    ctx = new AudioContext();
    source = ctx.createMediaStreamSource(stream);
  }
  const rate = ctx.sampleRate;

  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, "lna-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  node.port.onmessage = (e: MessageEvent<Float32Array>) =>
    onPcm(rate === sampleRate ? e.data : resampleLinear(e.data, rate, sampleRate));
  // Keep the node pulled by the graph without making a sound.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);
  if (ctx.state === "suspended") await ctx.resume();
  const track = stream.getAudioTracks()[0];
  if (track && onEnded) track.onended = onEnded;

  return {
    label: stream.getAudioTracks()[0]?.label ?? "",
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    },
  };
}

/** RMS of a block, 0–1, for a level meter. */
export function rms(pcm: Float32Array): number {
  let sum = 0;
  for (const v of pcm) sum += v * v;
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}
