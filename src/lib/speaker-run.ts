import { SPEAKER_THRESHOLD } from "@/workers/speaker.protocol";
import { decodeMediaFile, TARGET_SAMPLE_RATE } from "./audio";
import { db, getSegments, saveSpeakers } from "./db";
import { fingerprintSegments, type FingerprintProgress } from "./speaker-client";
import { assignSpeakers, clusterSpeakers, measurableSegments } from "./speakers";

export type SpeakerStage = "decode" | "fingerprint" | "save";

/**
 * Label each transcript line with a speaker: voice print per line (≥1 s),
 * cluster them, give short lines their neighbour's label, save. Needs the
 * saved recording. Returns the number of speakers found.
 */
export async function identifySpeakers(
  lectureId: string,
  { onStage, ...progress }: FingerprintProgress & { onStage?: (s: SpeakerStage) => void } = {},
  fingerprint = fingerprintSegments,
): Promise<number> {
  const [lecture, media, segments] = await Promise.all([
    db.lectures.get(lectureId),
    db.media.get(lectureId),
    getSegments(lectureId),
  ]);
  if (!lecture) throw new Error("This lecture no longer exists.");
  if (!media)
    throw new Error("Identifying speakers needs the saved recording. Attach the file first.");
  if (segments.length === 0) throw new Error("There's no transcript yet.");

  onStage?.("decode");
  const audio = await decodeMediaFile(
    new File([media.blob], lecture.fileName, { type: lecture.fileType }),
  );
  onStage?.("fingerprint");
  const candidates = measurableSegments(segments);
  const prints = await fingerprint(
    audio.pcm,
    TARGET_SAMPLE_RATE,
    candidates.map((i) => [segments[i]!.start, segments[i]!.end]),
    progress,
  );
  onStage?.("save");
  // Lines with too little speech get their nearest neighbour's speaker.
  const measured = candidates.filter((_, k) => prints[k]);
  const vectors = prints.filter((v): v is Float32Array => v !== null);
  const labels = assignSpeakers(segments, measured, clusterSpeakers(vectors, SPEAKER_THRESHOLD));
  await saveSpeakers(lectureId, labels);
  return labels.length ? Math.max(...labels) + 1 : 0;
}
