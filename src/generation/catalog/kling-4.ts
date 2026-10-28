import type { ModelEntry } from "./types";

/** Kling 4.0 is not in the public docs yet; the schema comes from the
    api-reference pages on open.higgsfield.ai (kling-video/v4.0/*). */
const kling4Settings = {
  aspectRatio: { type: "enum", values: ["adaptive", "9:16", "16:9", "1:1", "21:9"], default: "9:16" },
  duration: { type: "range", min: 3, max: 30, default: 10 },
  resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
} as const satisfies ModelEntry["settings"];

/** One entry for text, image and reference to video. With a start frame the
    references become middle keyframes (up to 8); without one they guide a new
    video as @image_1… / @video_1… */
export const kling4: ModelEntry = {
  id: "kling-4",
  surface: "video",
  label: "Kling 4.0",
  roles: { start: 1, end: 1, reference: 10, video: 5 },
  settings: kling4Settings,
};

/** The first video is the source (@video_1); further videos are references
    from @video_2 on. */
export const kling4Edit: ModelEntry = {
  id: "kling-4-edit",
  surface: "video",
  label: "Kling 4.0 Edit",
  roles: { video: 6, reference: 10 },
  settings: kling4Settings,
};
