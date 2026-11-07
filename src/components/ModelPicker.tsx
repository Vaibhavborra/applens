import { MODELS, pickVariant, type Device, type GpuInfo, type ModelId } from "@/lib/models";

interface Props {
  value: ModelId;
  onChange: (id: ModelId) => void;
  device: Device;
  gpu: GpuInfo;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, device, gpu, disabled = false }: Props) {
  return (
    <fieldset disabled={disabled} className="disabled:opacity-60">
      <legend className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Transcription quality
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {MODELS.map((m) => {
          const variant = pickVariant(m, device, gpu);
          const unavailable = variant === null;
          const checked = value === m.id;
          return (
            <label
              key={m.id}
              className={`relative flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 ${
                checked
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              } ${unavailable ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="model"
                value={m.id}
                checked={checked}
                disabled={unavailable}
                onChange={() => onChange(m.id)}
                className="sr-only"
              />
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {variant ? `${variant.sizeMB} MB` : "WebGPU only"}
                </span>
              </span>
              <span className="mt-0.5 text-zinc-500 dark:text-zinc-400">{m.blurb}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Running on{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {device === "webgpu" ? "WebGPU (GPU)" : "WebAssembly (CPU)"}
        </span>
        . The model downloads once, then it's cached for offline use.
      </p>
    </fieldset>
  );
}
