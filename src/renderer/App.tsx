import { useCallback, useEffect, useMemo, useState } from "react";
import { QUALITY_PRESETS } from "../shared/presets.js";
import type {
  AiBackend,
  ArtifactKind,
  BatchProcessorSettings,
  Diagnostics,
  FilePickKind,
  JobEvent,
  ProcessorSettings,
  QualityPresetId
} from "../shared/types.js";

type Artifact = {
  kind: ArtifactKind;
  path: string;
  backend?: AiBackend;
};

type SummaryResult = {
  backend: AiBackend;
  summary: string;
  wordCount: number;
  seconds: number;
};

type QueueStatus = "pending" | "running" | "done" | "failed" | "cancelled";

type QueueItem = {
  path: string;
  name: string;
  size?: number;
  status: QueueStatus;
  outputDir?: string;
  error?: string;
};

const AI_BACKENDS: Array<{ id: AiBackend; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "ollama", label: "Ollama Qwen" }
];

const DEFAULT_SETTINGS: ProcessorSettings = {
  episodePath: "",
  introPath: "",
  logoPath: "",
  outputDir: "",
  includeIntro: true,
  makeMp4: true,
  makeWav: true,
  makeTinyMp3: true,
  runAi: true,
  aiBackends: ["claude", "codex", "ollama"],
  whisperModel: "turbo",
  tinyMp3BitrateKbps: "auto",
  qualityPresetId: "high1080",
  useGpuEncoding: true,
  generateTitle: true,
  primaryAiBackend: "claude",
  episodeNumberOverride: ""
};

export function App() {
  const [settings, setSettings] =
    useState<ProcessorSettings>(DEFAULT_SETTINGS);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [summaryResults, setSummaryResults] = useState<SummaryResult[]>([]);
  const [running, setRunning] = useState(false);
  const [completedDir, setCompletedDir] = useState<string | null>(null);
  const [introOverridden, setIntroOverridden] = useState(false);
  const [outputOverridden, setOutputOverridden] = useState(false);

  useEffect(() => {
    void refreshDiagnostics();
    void loadSharedDefaults();
    return window.podcast.onJobEvent((event) => {
      setEvents((current) => [...current, event].slice(-240));
      if (event.type === "artifact") {
        setArtifacts((current) => [
          ...current,
          { kind: event.kind, path: event.path, backend: event.backend }
        ]);
      }
      if (event.type === "summary-result") {
        setSummaryResults((current) => [
          ...current.filter((item) => item.backend !== event.backend),
          {
            backend: event.backend,
            summary: event.summary,
            wordCount: event.wordCount,
            seconds: event.seconds
          }
        ]);
      }
      if (event.type === "batch-item-start") {
        setSummaryResults([]);
        setQueueItems((current) =>
          current.map((item) => ({
            ...item,
            status:
              item.path === event.episodePath
                ? "running"
                : item.status === "running"
                  ? "pending"
                  : item.status
          }))
        );
      }
      if (event.type === "batch-item-complete") {
        setQueueItems((current) =>
          current.map((item) =>
            item.path === event.episodePath
              ? { ...item, status: "done", outputDir: event.outputDir }
              : item
          )
        );
      }
      if (event.type === "complete") {
        setRunning(false);
        setCompletedDir(event.outputDir);
      }
      if (event.type === "error" && event.step === "processing") {
        setQueueItems((current) =>
          current.map((item) => {
            if (/cancel/i.test(event.message)) {
              if (item.status === "running" || item.status === "pending") {
                return { ...item, status: "cancelled", error: event.message };
              }
              return item;
            }
            if (item.status === "running") {
              return { ...item, status: "failed", error: event.message };
            }
            if (running && item.status === "pending") {
              return { ...item, status: "cancelled" };
            }
            return item;
          })
        );
        setRunning(false);
      }
    });
  }, [running]);

  const refreshDiagnostics = useCallback(async () => {
    const nextDiagnostics = await window.podcast.getDiagnostics();
    setDiagnostics(nextDiagnostics);
    if (!nextDiagnostics.nvencAvailable) {
      setSettings((current) => ({ ...current, useGpuEncoding: false }));
    }
  }, []);

  const loadSharedDefaults = useCallback(async () => {
    const defaults = await window.podcast.getSharedDefaults();
    if (defaults.introPath) {
      setSettings((current) => ({
        ...current,
        introPath: current.introPath || defaults.introPath
      }));
    }
  }, []);

  const setEpisodeSelection = useCallback(async (items: QueueItem[]) => {
    const uniqueItems = dedupeQueueItems(items);
    const uniquePaths = uniqueItems.map((item) => item.path);
    if (uniquePaths.length === 0) {
      return;
    }
    const firstPath = uniquePaths[0];
    setQueueItems(uniqueItems);
    setSettings((current) => ({
      ...current,
      episodePath: firstPath,
      episodeNumberOverride:
        uniquePaths.length > 1 ? "" : current.episodeNumberOverride
    }));
    const detected = await window.podcast.autoDetectPaths(firstPath);
    setSettings((current) => ({
      ...current,
      episodePath: firstPath,
      introPath: introOverridden
        ? current.introPath
        : detected.introPath ?? current.introPath,
      logoPath: detected.logoPath ?? current.logoPath,
      outputDir: outputOverridden ? current.outputDir : detected.outputDir,
      episodeNumberOverride:
        uniquePaths.length > 1 ? "" : current.episodeNumberOverride
    }));
    if (detected.logoPath) {
      setLogoPreview(await window.podcast.readImageDataUrl(detected.logoPath));
    }
  }, [introOverridden, outputOverridden]);

  const setPath = useCallback(
    async (kind: FilePickKind, filePath: string | null) => {
      if (!filePath) {
        return;
      }

      if (kind === "episode") {
        await setEpisodeSelection([queueItemFromPath(filePath)]);
        return;
      }

      if (kind === "logo") {
        setSettings((current) => ({ ...current, logoPath: filePath }));
        setLogoPreview(await window.podcast.readImageDataUrl(filePath));
        return;
      }

      if (kind === "intro") {
        setIntroOverridden(true);
      }
      if (kind === "outputDir") {
        setOutputOverridden(true);
      }
      const key = kind === "intro" ? "introPath" : "outputDir";
      setSettings((current) => ({ ...current, [key]: filePath }));
    },
    [setEpisodeSelection]
  );

  const pickPath = useCallback(
    async (kind: FilePickKind) => {
      await setPath(kind, await window.podcast.pickPath(kind));
    },
    [setPath]
  );

  const pickEpisodes = useCallback(async () => {
    await setEpisodeSelection(
      (await window.podcast.pickEpisodePaths()).map(queueItemFromPath)
    );
  }, [setEpisodeSelection]);

  const removeQueueItem = useCallback((path: string) => {
    setQueueItems((current) => {
      const next = current.filter((item) => item.path !== path);
      if (next.length === 0) {
        setSettings((settingsCurrent) => ({
          ...settingsCurrent,
          episodePath: "",
          episodeNumberOverride: ""
        }));
      } else {
        setSettings((settingsCurrent) => ({
          ...settingsCurrent,
          episodePath: next[0].path,
          episodeNumberOverride:
            next.length > 1 ? "" : settingsCurrent.episodeNumberOverride
        }));
      }
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueueItems([]);
    setSettings((current) => ({
      ...current,
      episodePath: "",
      episodeNumberOverride: ""
    }));
  }, []);

  const updateSetting = useCallback(
    <K extends keyof ProcessorSettings>(key: K, value: ProcessorSettings[K]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const toggleBackend = useCallback((backend: AiBackend, enabled: boolean) => {
    setSettings((current) => {
      const next = enabled
        ? [...new Set([...current.aiBackends, backend])]
        : current.aiBackends.filter((item) => item !== backend);
      return { ...current, aiBackends: next };
    });
  }, []);

  const canStart = useMemo(() => {
    if (running || queueItems.length === 0) {
      return false;
    }
    if (settings.makeMp4 && !settings.logoPath) {
      return false;
    }
    if (settings.includeIntro && !settings.introPath) {
      return false;
    }
    if (settings.runAi && settings.aiBackends.length === 0) {
      return false;
    }
    return true;
  }, [queueItems.length, running, settings]);

  const startProcessing = useCallback(async () => {
    setRunning(true);
    setCompletedDir(null);
    setEvents([]);
    setArtifacts([]);
    setSummaryResults([]);
    setQueueItems((current) =>
      current.map((item) => ({ ...item, status: "pending", outputDir: undefined }))
    );
    try {
      const batchSettings: BatchProcessorSettings = {
        ...settings,
        episodePaths: queueItems.map((item) => item.path)
      };
      await window.podcast.startJob(batchSettings);
    } catch (error) {
      setRunning(false);
      setEvents((current) => [
        ...current,
        {
          type: "error",
          step: "start",
          message: error instanceof Error ? error.message : String(error)
        }
      ]);
    }
  }, [queueItems, settings]);

  const latestEvent = events.at(-1);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Welcome to Grass Valley</p>
          <h1>Episode Processor</h1>
        </div>
        <div className="topbar-actions">
          <button className="button secondary" onClick={refreshDiagnostics}>
            Refresh checks
          </button>
          {completedDir ? (
            <button
              className="button secondary"
              onClick={() => void window.podcast.openPath(completedDir)}
            >
              Open output
            </button>
          ) : null}
        </div>
      </header>

      <section className="workspace">
        <div className="left-pane">
          <DropZone
            title="Episode WAV"
            items={queueItems}
            hint="Drop one or more raw episode WAVs here."
            onPick={() => void pickEpisodes()}
            onDropItems={(items) => void setEpisodeSelection(items)}
          />
          <QueuePanel
            items={queueItems}
            running={running}
            onRemove={removeQueueItem}
            onClear={clearQueue}
          />

          <div className="field-grid">
            <PathField
              label="Intro WAV"
              value={settings.introPath}
              disabled={!settings.includeIntro}
              onPick={() => void pickPath("intro")}
            />
            <PathField
              label="Output folder"
              value={settings.outputDir}
              onPick={() => void pickPath("outputDir")}
            />
          </div>

          <LogoPicker
            path={settings.logoPath}
            preview={logoPreview}
            disabled={!settings.makeMp4}
            onPick={() => void pickPath("logo")}
            onDropPath={(filePath) => void setPath("logo", filePath)}
          />

          <SettingsPanel
            settings={settings}
            diagnostics={diagnostics}
            episodeCount={queueItems.length}
            onUpdate={updateSetting}
            onToggleBackend={toggleBackend}
          />
        </div>

        <aside className="right-pane">
          <DiagnosticsPanel diagnostics={diagnostics} />

          <div className="run-panel">
            <div>
              <h2>Run</h2>
              <p>
                Hosts are locked as Maxx and Lindsay for transcript and summary
                prompts.
              </p>
            </div>
            <div className="run-actions">
              <button
                className="button primary"
                disabled={!canStart}
                onClick={() => void startProcessing()}
              >
                {running ? "Processing..." : "Process episode"}
              </button>
              <button
                className="button secondary"
                disabled={!running}
                onClick={() => void window.podcast.cancelJob()}
              >
                Cancel
              </button>
            </div>
            {latestEvent ? <StatusLine event={latestEvent} /> : null}
          </div>

          <ArtifactsPanel artifacts={artifacts} />
          <SummaryPanel results={summaryResults} />
          <EventLog events={events} />
        </aside>
      </section>
    </main>
  );
}

function DropZone({
  title,
  items,
  hint,
  onPick,
  onDropItems
}: {
  title: string;
  items: QueueItem[];
  hint: string;
  onPick: () => void;
  onDropItems: (items: QueueItem[]) => void;
}) {
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        onDropItems(
          files.map((file) => ({
            path: window.podcast.getPathForFile(file),
            name: file.name,
            size: file.size,
            status: "pending"
          }))
        );
      }
    },
    [onDropItems]
  );
  const selectedLabel =
    items.length === 0
      ? hint
      : items.length === 1
        ? items[0].name
        : `${items.length} episodes selected`;

  return (
    <div
      className="drop-zone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div>
        <span className="label">{title}</span>
        <strong>{selectedLabel}</strong>
        {items.length === 1 ? <small>{items[0].path}</small> : null}
        {items.length > 1 ? (
          <small>{items.map((item) => item.name).join(", ")}</small>
        ) : null}
      </div>
      <button className="button secondary" onClick={onPick}>
        Choose
      </button>
    </div>
  );
}

function QueuePanel({
  items,
  running,
  onRemove,
  onClear
}: {
  items: QueueItem[];
  running: boolean;
  onRemove: (path: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const doneCount = items.filter((item) => item.status === "done").length;

  return (
    <div className="queue-panel">
      <div className="queue-header">
        <div>
          <h2>Queue</h2>
          <p>
            {items.length} selected · {pendingCount} pending · {doneCount} done
          </p>
        </div>
        <button className="button secondary" disabled={running} onClick={onClear}>
          Clear queue
        </button>
      </div>
      <div className="queue-list">
        {items.map((item) => (
          <div key={item.path} className="queue-row">
            <span className={`queue-dot ${item.status}`} />
            <div>
              <strong>{item.name}</strong>
              <small>
                {formatSize(item.size)}
                {item.outputDir ? ` · ${item.outputDir}` : ""}
                {item.error ? ` · ${item.error}` : ""}
              </small>
            </div>
            <span className="queue-status">{item.status}</span>
            <button
              className="button secondary compact"
              disabled={running}
              onClick={() => onRemove(item.path)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PathField({
  label,
  value,
  disabled,
  onPick
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <div className={`path-field${disabled ? " muted" : ""}`}>
      <span className="label">{label}</span>
      <strong>{value ? fileName(value) : "Not selected"}</strong>
      {value ? <small>{value}</small> : null}
      <button className="button secondary" disabled={disabled} onClick={onPick}>
        Choose
      </button>
    </div>
  );
}

function LogoPicker({
  path,
  preview,
  disabled,
  onPick,
  onDropPath
}: {
  path: string;
  preview: string | null;
  disabled: boolean;
  onPick: () => void;
  onDropPath: (filePath: string) => void;
}) {
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files.item(0);
      if (file) {
        onDropPath(window.podcast.getPathForFile(file));
      }
    },
    [onDropPath]
  );

  return (
    <div
      className={`logo-picker${disabled ? " muted" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="logo-preview">
        {preview ? <img src={preview} alt="Selected podcast logo" /> : <span />}
      </div>
      <div>
        <span className="label">YouTube logo</span>
        <strong>{path ? fileName(path) : "Drop or choose the static image"}</strong>
        {path ? <small>{path}</small> : null}
      </div>
      <button className="button secondary" disabled={disabled} onClick={onPick}>
        Choose
      </button>
    </div>
  );
}

function SettingsPanel({
  settings,
  diagnostics,
  episodeCount,
  onUpdate,
  onToggleBackend
}: {
  settings: ProcessorSettings;
  diagnostics: Diagnostics | null;
  episodeCount: number;
  onUpdate: <K extends keyof ProcessorSettings>(
    key: K,
    value: ProcessorSettings[K]
  ) => void;
  onToggleBackend: (backend: AiBackend, enabled: boolean) => void;
}) {
  return (
    <div className="settings-panel">
      <h2>Settings</h2>
      <div className="check-grid">
        <Toggle
          label="Add intro"
          checked={settings.includeIntro}
          onChange={(checked) => onUpdate("includeIntro", checked)}
        />
        <Toggle
          label="YouTube MP4"
          checked={settings.makeMp4}
          onChange={(checked) => onUpdate("makeMp4", checked)}
        />
        <Toggle
          label="Spotify WAV"
          checked={settings.makeWav}
          onChange={(checked) => onUpdate("makeWav", checked)}
        />
        <Toggle
          label="Tiny MP3"
          checked={settings.makeTinyMp3}
          onChange={(checked) => onUpdate("makeTinyMp3", checked)}
        />
        <Toggle
          label="AI outputs"
          checked={settings.runAi}
          onChange={(checked) => onUpdate("runAi", checked)}
        />
        <Toggle
          label="Generate title"
          checked={settings.generateTitle}
          disabled={!settings.runAi}
          onChange={(checked) => onUpdate("generateTitle", checked)}
        />
        <Toggle
          label="GPU encode"
          checked={settings.useGpuEncoding}
          disabled={!diagnostics?.nvencAvailable}
          onChange={(checked) => onUpdate("useGpuEncoding", checked)}
        />
      </div>

      <div className="select-grid">
        <label>
          <span className="label">Video preset</span>
          <select
            value={settings.qualityPresetId}
            onChange={(event) =>
              onUpdate("qualityPresetId", event.target.value as QualityPresetId)
            }
          >
            {QUALITY_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Whisper model</span>
          <select
            value={settings.whisperModel}
            onChange={(event) =>
              onUpdate(
                "whisperModel",
                event.target.value as ProcessorSettings["whisperModel"]
              )
            }
          >
            <option value="turbo">turbo</option>
            <option value="tiny">tiny</option>
            <option value="base">base</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
            <option value="large-v3">large-v3</option>
          </select>
        </label>
        <label>
          <span className="label">Tiny MP3 bitrate</span>
          <select
            value={settings.tinyMp3BitrateKbps}
            onChange={(event) =>
              onUpdate(
                "tinyMp3BitrateKbps",
                (event.target.value === "auto"
                  ? "auto"
                  : Number(event.target.value)) as ProcessorSettings["tinyMp3BitrateKbps"]
              )
            }
          >
            <option value="auto">Auto under 24 MB</option>
            <option value={16}>16 kbps</option>
            <option value={24}>24 kbps</option>
            <option value={32}>32 kbps</option>
            <option value={64}>64 kbps</option>
          </select>
        </label>
        <label>
          <span className="label">Primary AI</span>
          <select
            value={settings.primaryAiBackend}
            disabled={!settings.runAi}
            onChange={(event) =>
              onUpdate("primaryAiBackend", event.target.value as AiBackend)
            }
          >
            {AI_BACKENDS.map((backend) => (
              <option key={backend.id} value={backend.id}>
                {backend.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Episode number</span>
          <input
            value={settings.episodeNumberOverride ?? ""}
            placeholder="auto from #NN"
            disabled={episodeCount > 1}
            onChange={(event) =>
              onUpdate("episodeNumberOverride", event.target.value)
            }
          />
          {episodeCount > 1 ? (
            <small>Batch mode uses each filename's #NN automatically.</small>
          ) : null}
        </label>
      </div>

      <div className="backend-row">
        {AI_BACKENDS.map((backend) => (
          <Toggle
            key={backend.id}
            label={backend.label}
            checked={settings.aiBackends.includes(backend.id)}
            disabled={!settings.runAi}
            onChange={(checked) => onToggleBackend(backend.id, checked)}
          />
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle${disabled ? " muted" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostics | null }) {
  return (
    <div className="diagnostics-panel">
      <h2>Checks</h2>
      {diagnostics ? (
        <div className="tool-list">
          {diagnostics.tools.map((tool) => (
            <div key={tool.name} className="tool-row">
              <span className={tool.found ? "dot ok" : "dot bad"} />
              <strong>{tool.name}</strong>
              <small>{tool.version ?? tool.path ?? "Missing"}</small>
            </div>
          ))}
          <div className="tool-row">
            <span className={diagnostics.nvencAvailable ? "dot ok" : "dot warn"} />
            <strong>NVENC</strong>
            <small>
              {diagnostics.nvencAvailable
                ? "Available"
                : "Not available in selected FFmpeg"}
            </small>
          </div>
          <div className="tool-row">
            <span className="dot ok" />
            <strong>Selected FFmpeg</strong>
            <small>{diagnostics.selectedFfmpegPath ?? "Unknown"}</small>
          </div>
          <div className="tool-row">
            <span className="dot ok" />
            <strong>Selected FFprobe</strong>
            <small>{diagnostics.selectedFfprobePath ?? "Unknown"}</small>
          </div>
          <div className="tool-row">
            <span
              className={diagnostics.ollamaModelAvailable ? "dot ok" : "dot bad"}
            />
            <strong>Qwen</strong>
            <small>
              {diagnostics.ollamaModelAvailable
                ? "qwen3-coder-emergency:latest"
                : "Model not found"}
            </small>
          </div>
        </div>
      ) : (
        <p>Checking local tools...</p>
      )}
    </div>
  );
}

function StatusLine({ event }: { event: JobEvent }) {
  const text =
    event.type === "complete"
      ? "Processing complete"
      : event.type === "batch-start"
        ? event.message
        : event.type === "batch-item-start"
          ? `Episode ${event.index} of ${event.total}: ${fileName(event.episodePath)}`
          : event.type === "batch-item-complete"
            ? `Finished episode ${event.index} of ${event.total}`
      : event.type === "artifact"
        ? `Created ${event.kind}`
        : event.type === "summary-result"
          ? `${event.backend} summary ready (${event.wordCount} words, ${event.seconds}s)`
          : event.message;
  const percent = event.type === "progress" ? event.percent : undefined;

  return (
    <div className="status-line">
      <span>{text}</span>
      {typeof percent === "number" ? (
        <div className="progress-track" aria-label={`Progress ${percent}%`}>
          <div style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function SummaryPanel({ results }: { results: SummaryResult[] }) {
  return (
    <div className="summaries-panel">
      <h2>Summaries</h2>
      {results.length === 0 ? (
        <p>Model summaries will appear here as each backend finishes.</p>
      ) : (
        <div className="summary-list">
          {results.map((result) => (
            <article key={result.backend} className="summary-card">
              <h3>
                {result.backend}
                <span>
                  {result.wordCount} words · {result.seconds}s
                </span>
              </h3>
              <p>{result.summary}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactsPanel({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <div className="artifacts-panel">
      <h2>Artifacts</h2>
      {artifacts.length === 0 ? (
        <p>Created files will appear here.</p>
      ) : (
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <button
              key={`${artifact.kind}-${artifact.path}`}
              className="artifact-row"
              onClick={() => void window.podcast.openPath(artifact.path)}
            >
              <strong>
                {artifact.backend ? `${artifact.backend} ` : ""}
                {artifact.kind}
              </strong>
              <small>{artifact.path}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventLog({ events }: { events: JobEvent[] }) {
  return (
    <div className="event-log">
      <h2>Log</h2>
      {events.length === 0 ? (
        <p>Progress messages will appear during processing.</p>
      ) : (
        <ol>
          {events.map((event, index) => (
            <li key={`${event.type}-${index}`}>
              <strong>{eventLabel(event)}</strong>
              <span>{eventText(event)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function eventLabel(event: JobEvent): string {
  if (event.type === "batch-start") {
    return "batch";
  }
  if (event.type === "batch-item-start") {
    return `episode ${event.index}/${event.total}`;
  }
  if (event.type === "batch-item-complete") {
    return `done ${event.index}/${event.total}`;
  }
  if (event.type === "artifact") {
    return event.backend ? `${event.backend} ${event.kind}` : event.kind;
  }
  if (event.type === "summary-result") {
    return `${event.backend} summary`;
  }
  if (event.type === "complete") {
    return "complete";
  }
  return event.step;
}

function eventText(event: JobEvent): string {
  if (event.type === "batch-start") {
    return event.message;
  }
  if (event.type === "batch-item-start") {
    return event.episodePath;
  }
  if (event.type === "batch-item-complete") {
    return event.outputDir;
  }
  if (event.type === "artifact") {
    return event.path;
  }
  if (event.type === "summary-result") {
    return `${event.wordCount} words in ${event.seconds}s`;
  }
  if (event.type === "complete") {
    return event.outputDir;
  }
  return event.message;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function queueItemFromPath(filePath: string): QueueItem {
  return {
    path: filePath,
    name: fileName(filePath),
    status: "pending"
  };
}

function dedupeQueueItems(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>();
  const next: QueueItem[] = [];
  for (const item of items) {
    if (!item.path || seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    next.push(item);
  }
  return next;
}

function formatSize(size: number | undefined): string {
  if (!size) {
    return "Size unknown";
  }
  const mb = size / 1024 / 1024;
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
