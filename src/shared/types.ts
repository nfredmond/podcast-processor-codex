export type AiBackend = "claude" | "codex" | "ollama";

export type QualityPresetId =
  | "preview720"
  | "balanced1080"
  | "high1080"
  | "max1080"
  | "uhd4k";

export type Encoder = "libx264" | "h264_nvenc";

export type QualityPreset = {
  id: QualityPresetId;
  label: string;
  width: number;
  height: number;
  fps: 30;
  encoder: Encoder;
  crf?: number;
  cq?: number;
  preset: string;
};

export type TinyMp3BitrateKbps = "auto" | 16 | 24 | 32 | 64;

export type ProcessorSettings = {
  episodePath: string;
  introPath?: string;
  logoPath: string;
  outputDir: string;
  includeIntro: boolean;
  makeMp4: boolean;
  makeWav: boolean;
  makeTinyMp3: boolean;
  runAi: boolean;
  aiBackends: AiBackend[];
  whisperModel: "tiny" | "turbo" | "base" | "small" | "medium" | "large" | "large-v3";
  tinyMp3BitrateKbps: TinyMp3BitrateKbps;
  qualityPresetId: QualityPresetId;
  useGpuEncoding: boolean;
  generateTitle: boolean;
  primaryAiBackend: AiBackend;
  episodeNumberOverride?: string;
};

export type BatchProcessorSettings = ProcessorSettings & {
  episodePaths: string[];
};

export type ToolStatus = {
  name: string;
  found: boolean;
  path?: string;
  version?: string;
  detail?: string;
};

export type Diagnostics = {
  tools: ToolStatus[];
  selectedFfmpegPath?: string;
  selectedFfprobePath?: string;
  nvencAvailable: boolean;
  ollamaModelAvailable: boolean;
  checkedAt: string;
};

export type ArtifactKind =
  | "wav"
  | "mp4"
  | "tiny-mp3"
  | "transcript"
  | "summary"
  | "comparison"
  | "title"
  | "metadata"
  | "log";

export type JobEvent =
  | { type: "batch-start"; total: number; message: string }
  | { type: "batch-item-start"; index: number; total: number; episodePath: string }
  | {
      type: "batch-item-complete";
      index: number;
      total: number;
      episodePath: string;
      outputDir: string;
    }
  | { type: "step-start"; step: string; message: string }
  | { type: "progress"; step: string; percent?: number; message: string }
  | { type: "artifact"; path: string; kind: ArtifactKind; backend?: AiBackend }
  | {
      type: "summary-result";
      backend: AiBackend;
      summary: string;
      wordCount: number;
      seconds: number;
    }
  | { type: "error"; step: string; message: string }
  | { type: "complete"; outputDir: string };

export type FilePickKind = "episode" | "intro" | "logo" | "outputDir";

export type AiModelResult = {
  cleanedTranscript: string;
  summary: string;
  seconds?: number;
  wordCount?: number;
  error?: string;
  notes?: string;
};
