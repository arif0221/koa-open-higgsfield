import type { ModelEntry } from "./types";

/** Higgsfield's motion transfer: the source video's performance onto the
    character and scene from the references. Duration follows the source
    (4–30 s); the prompt is optional. */
export const genjutsuMotion: ModelEntry = {
  id: "genjutsu-motion",
  surface: "video",
  label: "Genjutsu Motion Transfer",
  roles: { video: 1, reference: 8 },
  settings: {
    resolution: { type: "enum", values: ["480p", "720p", "1080p"], default: "480p" },
  },
};
