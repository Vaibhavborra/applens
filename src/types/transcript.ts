/** A timestamped piece of transcript, in seconds from the start of the media. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}
