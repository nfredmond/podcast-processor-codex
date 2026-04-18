import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GPU_PRESET, QUALITY_PRESETS } from "../shared/presets.js";
import type {
  AiBackend,
  AiModelResult,
  ArtifactKind,
  JobEvent,
  ProcessorSettings,
  QualityPreset
} from "../shared/types.js";
import { assertSuccess, captureCommand, streamCommand } from "./command.js";
import {
  defaultProcessedDir,
  isImagePath,
  isWavPath,
  pathExists,
  safeFileName,
  timestampForPath
} from "./file-utils.js";
import { getDiagnostics } from "./diagnostics.js";
import { type MediaTools, resolveMediaTools } from "./media-tools.js";

type EmitJobEvent = (event: JobEvent) => void;

type ArtifactRecord = {
  kind: ArtifactKind;
  path: string;
  backend?: AiBackend;
};

type BackendOutput = {
  backend: AiBackend;
  cleanedTranscript?: string;
  summary?: string;
  seconds?: number;
  wordCount?: number;
  transcriptPath?: string;
  summaryPath?: string;
  error?: string;
};

type RunMetadata = {
  podcast: string;
  hosts: string[];
  settings: ProcessorSettings;
  startedAt: string;
  completedAt?: string;
  outputDir: string;
  artifacts: ArtifactRecord[];
  diagnostics?: Awaited<ReturnType<typeof getDiagnostics>>;
};

const PODCAST_NAME = "Welcome to Grass Valley";
const HOSTS = ["Maxx", "Lindsay"];
const OLLAMA_MODEL = "qwen3-coder-emergency:latest";
const SUMMARY_WORD_RANGE = "60-110";
const AI_CHUNK_CHAR_LIMIT = 24_000;
const SUMMARY_CONTEXT_LIMIT = 60_000;

export class PodcastProcessor {
  private readonly artifacts: ArtifactRecord[] = [];
  private mediaTools?: MediaTools;

  constructor(
    private readonly settings: ProcessorSettings,
    private readonly emit: EmitJobEvent,
    private readonly signal: AbortSignal
  ) {}

  async run(): Promise<void> {
    this.ensureNotAborted();
    const startedAt = new Date().toISOString();
    const episodeBase = safeFileName(path.basename(this.settings.episodePath));
    const rootOutputDir =
      this.settings.outputDir || defaultProcessedDir(this.settings.episodePath);
    const runDir = path.join(rootOutputDir, `${episodeBase}-${timestampForPath()}`);
    const tempDir = path.join(runDir, ".tmp");
    const finalBase = `${PODCAST_NAME} - ${episodeBase}`;

    await mkdir(tempDir, { recursive: true });

    const metadata: RunMetadata = {
      podcast: PODCAST_NAME,
      hosts: HOSTS,
      settings: this.settings,
      startedAt,
      outputDir: runDir,
      artifacts: this.artifacts
    };

    try {
      await this.validateInputs();
      metadata.diagnostics = await getDiagnostics();

      const audioForProcessing = await this.prepareAudio(tempDir, finalBase);

      let finalWavPath: string | undefined;
      let finalMp4Path: string | undefined;
      if (this.settings.makeWav) {
        finalWavPath = await this.createWav(audioForProcessing, runDir, finalBase);
      }

      if (this.settings.makeMp4) {
        finalMp4Path = await this.createMp4(audioForProcessing, runDir, finalBase);
      }

      let tinyMp3Path: string | undefined;
      if (this.settings.makeTinyMp3 || this.settings.runAi) {
        tinyMp3Path = await this.createTinyMp3(
          finalWavPath ?? audioForProcessing,
          runDir,
          finalBase
        );
      }

      let transcript = "";
      let aiResults: BackendOutput[] = [];
      if (this.settings.runAi) {
        if (!tinyMp3Path) {
          throw new Error("AI processing requires a tiny MP3 artifact.");
        }
        transcript = await this.createWhisperTranscript(
          tinyMp3Path,
          tempDir,
          runDir,
          finalBase
        );
        aiResults = await this.createModelOutputs(transcript, runDir, finalBase);
      }

      let finalMediaBase = finalBase;
      if (this.settings.generateTitle && this.settings.runAi && transcript) {
        const title = await this.createEpisodeTitle(
          transcript,
          aiResults,
          runDir,
          finalBase
        );
        finalMediaBase = this.buildTitledMediaBase(title);
      }

      if (finalWavPath) {
        finalWavPath = await this.renameMediaArtifact(finalWavPath, finalMediaBase);
        this.recordArtifact("wav", finalWavPath);
      }
      if (finalMp4Path) {
        finalMp4Path = await this.renameMediaArtifact(finalMp4Path, finalMediaBase);
        this.recordArtifact("mp4", finalMp4Path);
      }

      metadata.completedAt = new Date().toISOString();
      const metadataPath = path.join(runDir, "run-metadata.json");
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      this.recordArtifact("metadata", metadataPath);
      this.emit({ type: "complete", outputDir: runDir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "error", step: "processing", message });

      metadata.completedAt = new Date().toISOString();
      const metadataPath = path.join(runDir, "run-metadata.json");
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      this.recordArtifact("metadata", metadataPath);
      throw error;
    }
  }

  private async validateInputs(): Promise<void> {
    this.emit({
      type: "step-start",
      step: "validate",
      message: "Checking selected files and required tools"
    });

    if (!this.settings.episodePath || !(await pathExists(this.settings.episodePath))) {
      throw new Error("Choose an episode WAV file before starting.");
    }
    if (!isWavPath(this.settings.episodePath)) {
      throw new Error("The episode input must be a WAV file.");
    }
    if (
      this.settings.includeIntro &&
      (!this.settings.introPath || !(await pathExists(this.settings.introPath)))
    ) {
      throw new Error("Intro is enabled, but no intro WAV was found or selected.");
    }
    if (this.settings.includeIntro && this.settings.introPath && !isWavPath(this.settings.introPath)) {
      throw new Error("The intro input must be a WAV file.");
    }
    if (this.settings.makeMp4) {
      if (!this.settings.logoPath || !(await pathExists(this.settings.logoPath))) {
        throw new Error("MP4 creation requires a logo image.");
      }
      if (!isImagePath(this.settings.logoPath)) {
        throw new Error("The logo must be a PNG, JPG, JPEG, or WEBP image.");
      }
    }

    this.mediaTools = await resolveMediaTools();
    if (!this.mediaTools.ffmpegPath || !(await pathExists(this.mediaTools.ffmpegPath))) {
      throw new Error("No usable ffmpeg binary was found.");
    }
    if (!this.mediaTools.ffprobePath || !(await pathExists(this.mediaTools.ffprobePath))) {
      throw new Error("No usable ffprobe binary was found.");
    }

    const requiredTools: string[] = [];
    if (this.settings.runAi) {
      requiredTools.push("whisper");
    }

    for (const tool of requiredTools) {
      const result = await captureCommand("bash", ["-lc", `command -v ${tool}`]);
      if (result.code !== 0) {
        throw new Error(`${tool} was not found in PATH.`);
      }
    }

    this.emit({
      type: "progress",
      step: "validate",
      message: "Inputs and required tools are ready"
    });
  }

  private async prepareAudio(tempDir: string, finalBase: string): Promise<string> {
    this.ensureNotAborted();
    if (!this.settings.includeIntro || !this.settings.introPath) {
      return this.settings.episodePath;
    }

    this.emit({
      type: "step-start",
      step: "concat",
      message: "Merging intro with episode audio"
    });

    const outputPath = path.join(tempDir, `${finalBase} - with-intro.wav`);
    const args = [
      "-y",
      "-i",
      this.settings.introPath,
      "-i",
      this.settings.episodePath,
      "-filter_complex",
      "[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[a0][a1]concat=n=2:v=0:a=1[out]",
      "-map",
      "[out]",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-loglevel",
      "error",
      outputPath
    ];

    const result = await streamCommand(this.ffmpegPath(), args, {
      signal: this.signal,
      killProcessGroup: true,
      onStderrLine: (line) =>
        this.emit({ type: "progress", step: "concat", message: line })
    });
    assertSuccess(result, "Intro merge");
    this.emit({
      type: "progress",
      step: "concat",
      percent: 100,
      message: "Intro merged"
    });
    return outputPath;
  }

  private async createWav(
    audioInput: string,
    runDir: string,
    finalBase: string
  ): Promise<string> {
    this.ensureNotAborted();
    this.emit({
      type: "step-start",
      step: "wav",
      message: "Creating Spotify WAV"
    });

    const outputPath = path.join(runDir, `${finalBase}.wav`);
    const args = [
      "-y",
      "-i",
      audioInput,
      "-vn",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-loglevel",
      "error",
      outputPath
    ];

    const result = await streamCommand(this.ffmpegPath(), args, {
      signal: this.signal,
      killProcessGroup: true,
      onStderrLine: (line) =>
        this.emit({ type: "progress", step: "wav", message: line })
    });
    assertSuccess(result, "WAV creation");
    this.emit({
      type: "progress",
      step: "wav",
      percent: 100,
      message: "Spotify WAV created"
    });
    return outputPath;
  }

  private async createMp4(
    audioInput: string,
    runDir: string,
    finalBase: string
  ): Promise<string> {
    this.ensureNotAborted();
    this.emit({
      type: "step-start",
      step: "mp4",
      message: "Creating YouTube MP4"
    });

    const duration = await this.getDurationSeconds(audioInput);
    const preset = await this.selectPreset();
    const outputPath = path.join(runDir, `${finalBase}.mp4`);
    const filter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
    const encoderArgs =
      preset.encoder === "h264_nvenc"
        ? [
            "-c:v",
            "h264_nvenc",
            "-preset",
            preset.preset,
            "-tune",
            "hq",
            "-rc",
            "constqp",
            "-qp",
            String(preset.cq ?? 23),
            "-r",
            String(preset.fps),
            "-bf",
            "0"
          ]
        : [
            "-c:v",
            "libx264",
            "-preset",
            preset.preset,
            "-crf",
            String(preset.crf ?? 20),
            "-r",
            String(preset.fps)
          ];

    const progressState = new Map<string, string>();
    const args = [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(preset.fps),
      "-i",
      this.settings.logoPath,
      "-i",
      audioInput,
      "-vf",
      filter,
      ...encoderArgs,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      "-loglevel",
      "error",
      outputPath
    ];

    const result = await streamCommand(this.ffmpegPath(), args, {
      signal: this.signal,
      killProcessGroup: true,
      onStdoutLine: (line) => {
        const [key, ...valueParts] = line.split("=");
        const value = valueParts.join("=");
        if (!key) {
          return;
        }
        progressState.set(key, value);
        if (key === "out_time_ms" || key === "out_time_us") {
          const currentSeconds = Number(value) / 1_000_000;
          const percent =
            duration > 0
              ? Math.min(99, Math.round((currentSeconds / duration) * 100))
              : undefined;
          this.emit({
            type: "progress",
            step: "mp4",
            percent,
            message:
              percent === undefined
                ? "Encoding MP4"
                : `Encoding MP4 (${percent}%)`
          });
        }
        if (key === "progress" && value === "end") {
          this.emit({
            type: "progress",
            step: "mp4",
            percent: 100,
            message: "YouTube MP4 created"
          });
        }
      },
      onStderrLine: (line) =>
        this.emit({ type: "progress", step: "mp4", message: line })
    });

    assertSuccess(result, "MP4 creation");
    return outputPath;
  }

  private async createTinyMp3(
    audioInput: string,
    runDir: string,
    finalBase: string
  ): Promise<string> {
    this.ensureNotAborted();
    this.emit({
      type: "step-start",
      step: "tiny-mp3",
      message: "Creating tiny MP3 for local transcription"
    });

    const outputPath = path.join(runDir, `${finalBase} - tiny.mp3`);
    const targetBitrate = await this.resolveTinyMp3Bitrate(audioInput);
    this.emit({
      type: "progress",
      step: "tiny-mp3",
      message: `Using ${targetBitrate} kbps MP3 bitrate`
    });
    const args = [
      "-y",
      "-i",
      audioInput,
      "-vn",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      `${targetBitrate}k`,
      "-loglevel",
      "error",
      outputPath
    ];

    const result = await streamCommand(this.ffmpegPath(), args, {
      signal: this.signal,
      killProcessGroup: true,
      onStderrLine: (line) =>
        this.emit({ type: "progress", step: "tiny-mp3", message: line })
    });
    assertSuccess(result, "Tiny MP3 creation");
    this.recordArtifact("tiny-mp3", outputPath);
    this.emit({
      type: "progress",
      step: "tiny-mp3",
      percent: 100,
      message: "Tiny MP3 created"
    });
    return outputPath;
  }

  private async createWhisperTranscript(
    tinyMp3Path: string,
    tempDir: string,
    runDir: string,
    finalBase: string
  ): Promise<string> {
    this.ensureNotAborted();
    this.emit({
      type: "step-start",
      step: "whisper",
      message: "Transcribing with local Whisper"
    });

    const prompt =
      "This is the podcast Welcome to Grass Valley. The current hosts are Maxx and Lindsay. Spell Maxx with two x letters. Spell Lindsay with an a.";
    const args = [
      tinyMp3Path,
      "--model",
      this.settings.whisperModel,
      "--language",
      "en",
      "--task",
      "transcribe",
      "--output_format",
      "txt",
      "--output_dir",
      tempDir,
      "--initial_prompt",
      prompt,
      "--verbose",
      "False"
    ];

    const result = await streamCommand("whisper", args, {
      signal: this.signal,
      killProcessGroup: true,
      onStdoutLine: (line) =>
        this.emit({ type: "progress", step: "whisper", message: line }),
      onStderrLine: (line) =>
        this.emit({ type: "progress", step: "whisper", message: line })
    });
    assertSuccess(result, "Whisper transcription");

    const generatedPath = path.join(
      tempDir,
      `${path.basename(tinyMp3Path, path.extname(tinyMp3Path))}.txt`
    );
    const transcript = await readFile(generatedPath, "utf8");
    const outputPath = path.join(runDir, `${finalBase} - whisper-transcript.txt`);
    await writeFile(outputPath, normalizeTranscript(transcript), "utf8");
    this.recordArtifact("transcript", outputPath);
    this.emit({
      type: "progress",
      step: "whisper",
      percent: 100,
      message: "Whisper transcript created"
    });
    return transcript;
  }

  private async createModelOutputs(
    transcript: string,
    runDir: string,
    finalBase: string
  ): Promise<BackendOutput[]> {
    const outputs = await Promise.all(
      this.settings.aiBackends.map(async (backend): Promise<BackendOutput> => {
        this.ensureNotAborted();
        const startedAt = performance.now();
        try {
          const result = await this.runAiBackend(backend, transcript);
          const summary = sanitizeOneParagraph(result.summary);
          const seconds = roundSeconds((performance.now() - startedAt) / 1000);
          const wordCount = countWords(summary);
          const transcriptPath = path.join(
            runDir,
            `${finalBase} - ${backend}-transcript.txt`
          );
          const summaryPath = path.join(
            runDir,
            `${finalBase} - ${backend}-summary.txt`
          );
          await writeFile(
            transcriptPath,
            normalizeTranscript(result.cleanedTranscript),
            "utf8"
          );
          await writeFile(summaryPath, `${summary}\n`, "utf8");
          this.recordArtifact("transcript", transcriptPath, backend);
          this.recordArtifact("summary", summaryPath, backend);
          this.emit({
            type: "summary-result",
            backend,
            summary,
            seconds,
            wordCount
          });
          return {
            backend,
            cleanedTranscript: result.cleanedTranscript,
            summary,
            seconds,
            wordCount,
            transcriptPath,
            summaryPath
          };
        } catch (error) {
          if (this.signal.aborted) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          const logPath = path.join(runDir, `${finalBase} - ${backend}-error.log`);
          await writeFile(logPath, `${message}\n`, "utf8");
          this.recordArtifact("log", logPath, backend);
          this.emit({
            type: "error",
            step: backend,
            message: `${backend} failed: ${message}`
          });
          return { backend, error: message };
        }
      })
    );

    const comparisonPath = await this.writeSummaryComparison(
      outputs,
      runDir,
      finalBase
    );
    this.recordArtifact("comparison", comparisonPath);
    return outputs;
  }

  private async runAiBackend(
    backend: AiBackend,
    transcript: string
  ): Promise<AiModelResult> {
    this.emit({
      type: "step-start",
      step: backend,
      message: `Creating ${backend} transcript and summary`
    });

    const normalized = normalizeTranscript(transcript);
    const chunks = chunkText(normalized, AI_CHUNK_CHAR_LIMIT);

    if (chunks.length === 1) {
      const raw = await this.invokeBackend(
        backend,
        buildFullJsonPrompt(normalized),
        `${backend} JSON pass`
      );
      const parsed = parseModelJson(raw);
      return {
        cleanedTranscript: parsed.cleanedTranscript || normalized,
        summary: sanitizeOneParagraph(parsed.summary),
        notes: parsed.notes
      };
    }

    const cleanedChunks: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      this.ensureNotAborted();
      this.emit({
        type: "progress",
        step: backend,
        percent: Math.round((index / chunks.length) * 80),
        message: `Cleaning transcript chunk ${index + 1} of ${chunks.length}`
      });
      const cleaned = await this.invokeBackend(
        backend,
        buildChunkCleanPrompt(chunks[index], index + 1, chunks.length),
        `${backend} chunk ${index + 1}`
      );
      cleanedChunks.push(stripCodeFence(cleaned).trim());
    }

    const cleanedTranscript = normalizeTranscript(cleanedChunks.join("\n\n"));
    const summaryContext = trimMiddle(cleanedTranscript, SUMMARY_CONTEXT_LIMIT);
    const summary = await this.invokeBackend(
      backend,
      buildSummaryPrompt(summaryContext),
      `${backend} summary`
    );

    return {
      cleanedTranscript,
      summary: sanitizeOneParagraph(summary)
    };
  }

  private async invokeBackend(
    backend: AiBackend,
    prompt: string,
    label: string
  ): Promise<string> {
    if (backend === "ollama") {
      return this.invokeOllama(prompt, label);
    }
    if (backend === "claude") {
      return this.invokeClaude(prompt, label);
    }
    return this.invokeCodex(prompt, label);
  }

  private async invokeClaude(prompt: string, label: string): Promise<string> {
    const result = await captureCommand(
      "claude",
      [
        "--print",
        "--output-format",
        "text",
        "--permission-mode",
        "dontAsk",
        "--tools",
        ""
      ],
      { input: prompt, signal: this.signal, killProcessGroup: true }
    );
    assertSuccess(result, label);
    return result.stdout.trim();
  }

  private async invokeCodex(prompt: string, label: string): Promise<string> {
    const outputPath = path.join(
      process.env.XDG_RUNTIME_DIR ?? "/tmp",
      `grass-valley-codex-${process.pid}-${Date.now()}.txt`
    );
    const result = await captureCommand(
      "codex",
      [
        "--ask-for-approval",
        "never",
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-last-message",
        outputPath,
        "-"
      ],
      { input: prompt, signal: this.signal, killProcessGroup: true }
    );
    assertSuccess(result, label);
    if (await pathExists(outputPath)) {
      return (await readFile(outputPath, "utf8")).trim();
    }
    return result.stdout.trim();
  }

  private async invokeOllama(prompt: string, label: string): Promise<string> {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system:
          "You are a careful podcast transcript editor and summary writer. Return only the requested content.",
        stream: false,
        options: {
          temperature: 0.2
        }
      }),
      signal: this.signal
    });

    if (!response.ok) {
      throw new Error(`${label} failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { response?: string; error?: string };
    if (body.error) {
      throw new Error(body.error);
    }
    return (body.response ?? "").trim();
  }

  private async writeSummaryComparison(
    outputs: BackendOutput[],
    runDir: string,
    finalBase: string
  ): Promise<string> {
    const lines = [`# Summaries for ${finalBase}`, ""];
    for (const backend of this.settings.aiBackends) {
      const output = outputs.find((item) => item.backend === backend);
      lines.push(`## ${backend}`);
      if (!output || output.error) {
        lines.push(`_failed: ${output?.error ?? "No output"}_`, "");
        continue;
      }
      lines.push(`_${output.wordCount ?? 0} words · ${output.seconds ?? 0}s_`);
      lines.push("", output.summary ?? "", "");
    }

    const comparisonPath = path.join(runDir, `${finalBase} - summaries_compare.md`);
    await writeFile(comparisonPath, `${lines.join("\n").trim()}\n`, "utf8");
    return comparisonPath;
  }

  private async createEpisodeTitle(
    transcript: string,
    outputs: BackendOutput[],
    runDir: string,
    finalBase: string
  ): Promise<string> {
    this.ensureNotAborted();
    this.emit({
      type: "step-start",
      step: "title",
      message: "Generating episode title"
    });

    const backend = this.selectTitleBackend(outputs);
    let title = "Episode";
    if (backend) {
      try {
        const rawTitle = await this.invokeBackend(
          backend,
          buildTitlePrompt(trimMiddle(normalizeTranscript(transcript), 8000)),
          `${backend} title`
        );
        title = sanitizeTitle(rawTitle);
      } catch (error) {
        if (this.signal.aborted) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.emit({
          type: "error",
          step: "title",
          message: `Title generation failed: ${message}`
        });
      }
    }

    if (looksLikeRefusal(title)) {
      title = "Episode";
    }

    const titlePath = path.join(runDir, `${finalBase} - generated-title.txt`);
    await writeFile(titlePath, `${title}\n`, "utf8");
    this.recordArtifact("title", titlePath);
    this.emit({
      type: "progress",
      step: "title",
      percent: 100,
      message: `Title: ${title}`
    });
    return title;
  }

  private selectTitleBackend(outputs: BackendOutput[]): AiBackend | undefined {
    const successfulBackends = new Set(
      outputs
        .filter((output) => output.summary && !output.error)
        .map((output) => output.backend)
    );
    if (successfulBackends.has(this.settings.primaryAiBackend)) {
      return this.settings.primaryAiBackend;
    }
    return this.settings.aiBackends.find((backend) => successfulBackends.has(backend));
  }

  private buildTitledMediaBase(title: string): string {
    const episodeNumber =
      this.settings.episodeNumberOverride?.trim() ||
      extractEpisodeNumber(path.basename(this.settings.episodePath));
    return sanitizeFileStem(`${PODCAST_NAME} #${episodeNumber} - ${title}`);
  }

  private async renameMediaArtifact(
    currentPath: string,
    finalMediaBase: string
  ): Promise<string> {
    const nextPath = path.join(
      path.dirname(currentPath),
      `${finalMediaBase}${path.extname(currentPath)}`
    );
    if (nextPath === currentPath) {
      return currentPath;
    }
    await rename(currentPath, nextPath);
    return nextPath;
  }

  private async resolveTinyMp3Bitrate(audioInput: string): Promise<number> {
    if (this.settings.tinyMp3BitrateKbps !== "auto") {
      return this.settings.tinyMp3BitrateKbps;
    }
    const duration = await this.getDurationSeconds(audioInput);
    if (!duration) {
      return 24;
    }
    const maxBytes = 24 * 1024 * 1024;
    const target = Math.floor((maxBytes * 8) / duration / 1000);
    return Math.max(16, Math.min(target, 32));
  }

  private async selectPreset(): Promise<QualityPreset> {
    if (this.settings.useGpuEncoding) {
      if (this.mediaTools?.nvencAvailable) {
        return GPU_PRESET;
      }
      this.emit({
        type: "progress",
        step: "mp4",
        message: "NVENC is not available in this FFmpeg build; using CPU encoding"
      });
    }

    return (
      QUALITY_PRESETS.find(
        (preset) => preset.id === this.settings.qualityPresetId
      ) ?? QUALITY_PRESETS[2]
    );
  }

  private async getDurationSeconds(filePath: string): Promise<number> {
    const result = await captureCommand(this.ffprobePath(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    if (result.code !== 0) {
      return 0;
    }
    return Number(result.stdout.trim()) || 0;
  }

  private ffmpegPath(): string {
    if (!this.mediaTools) {
      throw new Error("Media tools were not initialized.");
    }
    return this.mediaTools.ffmpegPath;
  }

  private ffprobePath(): string {
    if (!this.mediaTools) {
      throw new Error("Media tools were not initialized.");
    }
    return this.mediaTools.ffprobePath;
  }

  private recordArtifact(
    kind: ArtifactKind,
    artifactPath: string,
    backend?: AiBackend
  ): void {
    const artifact = { kind, path: artifactPath, backend };
    this.artifacts.push(artifact);
    this.emit({ type: "artifact", ...artifact });
  }

  private ensureNotAborted(): void {
    if (this.signal.aborted) {
      throw new Error("Processing was cancelled.");
    }
  }
}

function buildFullJsonPrompt(transcript: string): string {
  return `${baseAiRules()}

Return only valid JSON with this shape:
{"cleanedTranscript":"...","summary":"...","notes":"optional short notes"}

Clean the transcript enough for human review. Preserve the conversation content and do not invent speaker names or topics. Then write the platform summary.

Transcript:
${transcript}`;
}

function buildChunkCleanPrompt(chunk: string, index: number, total: number): string {
  return `${baseAiRules()}

Clean transcript chunk ${index} of ${total}. Preserve all conversation content. Fix obvious transcription errors, punctuation, casing, paragraph breaks, and the host spellings Maxx and Lindsay. Do not summarize this chunk. Return only the cleaned transcript text for this chunk.

Transcript chunk:
${chunk}`;
}

function buildSummaryPrompt(transcript: string): string {
  return `${baseAiRules()}

Write the final Spotify/YouTube summary from this cleaned transcript. Return only the summary paragraph.

Cleaned transcript:
${transcript}`;
}

function buildTitlePrompt(transcript: string): string {
  return `You are a podcast filename generator for "${PODCAST_NAME}" hosted by Maxx and Lindsay. Create a concise, descriptive filename suffix based on the transcript.

Format: "Guest Name on Topic" or "Guest Name - Brief Description".
Rules: maximum 50 characters, focus on guest name and main topic, no special characters except hyphens and spaces, be specific but concise, spell Maxx and Lindsay exactly.
Output only the suffix text with no quotes or extra commentary.

Transcript excerpt:
${transcript}`;
}

function baseAiRules(): string {
  return `You are processing ${PODCAST_NAME}. The current hosts are Maxx and Lindsay. Spell Maxx with two x letters and spell Lindsay exactly as Lindsay. Never write Max, Lindsey, or Lindsy. The summary must be exactly one paragraph, no title, no bullets, no line breaks, ${SUMMARY_WORD_RANGE} words by default, factual and engaging, suitable for both Spotify and YouTube, and must not discuss intro music or opening housekeeping.`;
}

function parseModelJson(raw: string): AiModelResult {
  const stripped = stripCodeFence(raw).trim();
  const candidates = [
    stripped,
    stripped.match(/\{[\s\S]*\}/)?.[0] ?? ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AiModelResult>;
      return {
        cleanedTranscript: String(parsed.cleanedTranscript ?? ""),
        summary: String(parsed.summary ?? ""),
        notes: parsed.notes ? String(parsed.notes) : undefined
      };
    } catch {
      continue;
    }
  }

  return {
    cleanedTranscript: stripped,
    summary: "Episode summary could not be parsed from the model output."
  };
}

function normalizeTranscript(value: string): string {
  return `${value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim()}\n`;
}

function sanitizeOneParagraph(value: string): string {
  return stripCodeFence(value)
    .replace(/^summary\s*:\s*/i, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function sanitizeTitle(value: string): string {
  const stripped = stripCodeFence(value)
    .replace(/^title\s*:\s*/i, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!stripped) {
    return "Episode";
  }
  return stripped.slice(0, 80).replace(/\s+-?\s*$/, "") || "Episode";
}

function sanitizeFileStem(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function looksLikeRefusal(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) {
    return true;
  }
  const refusalPrefixes = [
    "i ",
    "i'm ",
    "i am ",
    "i'll ",
    "sorry",
    "unfortunately",
    "i cannot",
    "i can't",
    "i need",
    "i don't",
    "as an ai",
    "here is",
    "here's",
    "the transcript",
    "this transcript"
  ];
  return (
    refusalPrefixes.some((prefix) => lower.startsWith(prefix)) ||
    value.split(/\s+/).length > 14 ||
    value.endsWith(".")
  );
}

function extractEpisodeNumber(fileName: string): string {
  return fileName.match(/#(\d+)/)?.[1] ?? "XX";
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function roundSeconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function trimMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const keep = Math.floor((maxLength - 80) / 2);
  return `${value.slice(0, keep)}

[... middle transcript omitted for summary context ...]

${value.slice(-keep)}`;
}

function chunkText(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) {
    return [value];
  }

  const paragraphs = value.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let start = 0; start < paragraph.length; start += maxChars) {
      chunks.push(paragraph.slice(start, start + maxChars));
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export async function fileSizeLabel(filePath: string): Promise<string> {
  const bytes = (await stat(filePath)).size;
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}
