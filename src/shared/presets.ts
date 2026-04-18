import type { QualityPreset } from "./types.js";

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: "preview720",
    label: "Fast Preview 720p",
    width: 1280,
    height: 720,
    fps: 30,
    encoder: "libx264",
    crf: 28,
    preset: "ultrafast"
  },
  {
    id: "balanced1080",
    label: "Balanced 1080p",
    width: 1920,
    height: 1080,
    fps: 30,
    encoder: "libx264",
    crf: 23,
    preset: "veryfast"
  },
  {
    id: "high1080",
    label: "High Quality 1080p",
    width: 1920,
    height: 1080,
    fps: 30,
    encoder: "libx264",
    crf: 20,
    preset: "medium"
  },
  {
    id: "max1080",
    label: "Maximum 1080p",
    width: 1920,
    height: 1080,
    fps: 30,
    encoder: "libx264",
    crf: 18,
    preset: "slow"
  },
  {
    id: "uhd4k",
    label: "Ultra HD 4K",
    width: 3840,
    height: 2160,
    fps: 30,
    encoder: "libx264",
    crf: 20,
    preset: "medium"
  }
];

export const GPU_PRESET: QualityPreset = {
  id: "high1080",
  label: "GPU 1080p",
  width: 1920,
  height: 1080,
  fps: 30,
  encoder: "h264_nvenc",
  cq: 23,
  preset: "p5"
};
