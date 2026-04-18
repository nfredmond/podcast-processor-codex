import path from "node:path";
import { captureCommand, findCommand } from "./command.js";
import { pathExists } from "./file-utils.js";

export type MediaTools = {
  ffmpegPath: string;
  ffprobePath: string;
  nvencAvailable: boolean;
};

export async function resolveMediaTools(): Promise<MediaTools> {
  const pathFfmpeg = await findCommand("ffmpeg");
  const candidates = uniqueValues([
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    pathFfmpeg
  ]);

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    if (await ffmpegHasNvenc(candidate)) {
      return {
        ffmpegPath: candidate,
        ffprobePath: await pairedFfprobe(candidate),
        nvencAvailable: true
      };
    }
  }

  const fallback = candidates.find(Boolean) ?? "ffmpeg";
  return {
    ffmpegPath: fallback,
    ffprobePath: await pairedFfprobe(fallback),
    nvencAvailable: false
  };
}

export async function ffmpegHasNvenc(ffmpegPath: string): Promise<boolean> {
  const result = await captureCommand(ffmpegPath, ["-hide_banner", "-encoders"]);
  return result.code === 0 && result.stdout.includes("h264_nvenc");
}

async function pairedFfprobe(ffmpegPath: string): Promise<string> {
  const sibling = path.join(path.dirname(ffmpegPath), "ffprobe");
  if (await pathExists(sibling)) {
    return sibling;
  }
  return (await findCommand("ffprobe")) ?? "ffprobe";
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
