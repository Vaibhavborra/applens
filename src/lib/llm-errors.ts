/**
 * WebGPU "device lost" surfaces from WebLLM as secondary errors (disposed
 * objects, deleted GrammarMatcher) after the GPU process resets. Typical cause:
 * a slow/integrated GPU hitting the OS GPU watchdog (Windows TDR) during prefill.
 */
export function isGpuDeviceLost(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /device (was )?lost|GPUDeviceLost|already been disposed|deleted object|DXGI_ERROR_DEVICE/i.test(
    msg,
  );
}

export function deviceLostMessage(gpuName: string | null): string {
  const which = gpuName ? ` (${gpuName})` : "";
  return (
    `Your GPU${which} stopped responding while writing notes. This usually means it's an integrated ` +
    `or low-power GPU that can't run the language model fast enough. If your computer also has a ` +
    `dedicated GPU, make the browser use it (Windows: Settings → System → Display → Graphics → ` +
    `your browser → High performance), restart the browser and try again. Your transcript is unaffected.`
  );
}
