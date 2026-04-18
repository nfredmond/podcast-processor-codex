import { stat } from "node:fs/promises";
import path from "node:path";

export function safeFileName(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function timestampForPath(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function defaultProcessedDir(episodePath: string): string {
  return path.join(path.dirname(episodePath), "Processed Files");
}

export function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(filePath);
}

export function isWavPath(filePath: string): boolean {
  return /\.wav$/i.test(filePath);
}
