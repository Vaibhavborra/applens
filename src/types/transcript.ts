/** A timestamped piece of transcript, in seconds from the start of the media. */
export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Speaker index (0-based) once speakers have been identified. */
  speaker?: number;
}
