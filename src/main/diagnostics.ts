import type { Diagnostics, ToolStatus } from "../shared/types.js";
import { captureCommand, findCommand } from "./command.js";
import { resolveMediaTools } from "./media-tools.js";

const OLLAMA_MODEL = "qwen3-coder-emergency:latest";

async function versionFor(tool: string): Promise<string | undefined> {
  const argsByTool: Record<string, string[]> = {
    ffmpeg: ["-hide_banner", "-version"],
    ffprobe: ["-hide_banner", "-version"],
    whisper: ["--help"],
    claude: ["--version"],
    codex: ["--version"],
    ollama: ["--version"]
  };

  const result = await captureCommand(tool, argsByTool[tool] ?? ["--version"]);
  if (result.code !== 0) {
    return undefined;
  }
  const firstLine = (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
  return firstLine || undefined;
}

async function inspectTool(name: string): Promise<ToolStatus> {
  const path = await findCommand(name);
  if (!path) {
    return { name, found: false };
  }

  let version: string | undefined;
  try {
    version = await versionFor(name);
  } catch {
    version = undefined;
  }

  return { name, found: true, path, version };
}

async function hasOllamaModel(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (body.models ?? []).some(
      (model) => model.name === OLLAMA_MODEL || model.model === OLLAMA_MODEL
    );
  } catch {
    return false;
  }
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const tools = await Promise.all(
    ["ffmpeg", "ffprobe", "whisper", "claude", "codex", "ollama"].map(
      inspectTool
    )
  );
  const [mediaTools, ollamaModelAvailable] = await Promise.all([
    resolveMediaTools(),
    hasOllamaModel()
  ]);

  return {
    tools,
    selectedFfmpegPath: mediaTools.ffmpegPath,
    selectedFfprobePath: mediaTools.ffprobePath,
    nvencAvailable: mediaTools.nvencAvailable,
    ollamaModelAvailable,
    checkedAt: new Date().toISOString()
  };
}
