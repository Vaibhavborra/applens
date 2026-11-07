import { useRef, useState, type DragEvent } from "react";

const ACCEPT = "audio/*,video/*,.mp3,.m4a,.wav,.flac,.ogg,.opus,.aac,.mp4,.mov,.mkv,.webm,.avi";

export function DropZone({
  onFile,
  disabled = false,
}: {
  onFile: (f: File) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        over
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
          : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-9 text-zinc-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        />
      </svg>
      <p className="mt-3 font-medium">Drop a lecture recording, or click to choose</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        mp3, m4a, wav, mp4, mov, webm, mkv… The file stays on your device.
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
