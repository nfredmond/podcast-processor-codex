import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BatchProcessorSettings,
  FilePickKind,
  JobEvent,
  ProcessorSettings
} from "../shared/types.js";
import { getDiagnostics } from "./diagnostics.js";
import { defaultProcessedDir, isImagePath, pathExists } from "./file-utils.js";
import { PodcastProcessor } from "./processor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;
let activeController: AbortController | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Welcome to Grass Valley Processor",
    backgroundColor: "#f5f7fa",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    void mainWindow.loadURL(startUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("diagnostics:get", async () => getDiagnostics());

ipcMain.handle(
  "dialog:pick",
  async (_event, kind: FilePickKind): Promise<string | null> => {
    const options = dialogOptionsFor(kind);
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  }
);

ipcMain.handle("dialog:pick-episodes", async (): Promise<string[]> => {
  const options: Electron.OpenDialogOptions = {
    title: "Choose episode WAV files",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "WAV audio", extensions: ["wav"] }]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle(
  "file:image-data-url",
  async (_event, filePath: string): Promise<string | null> => {
    if (!filePath || !(await pathExists(filePath)) || !isImagePath(filePath)) {
      return null;
    }
    const extension = path.extname(filePath).toLowerCase();
    const mime =
      extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "image/png";
    const bytes = await readFile(filePath);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
);

ipcMain.handle(
  "paths:default-output-dir",
  (_event, episodePath: string): string => defaultProcessedDir(episodePath)
);

ipcMain.handle("paths:shared-defaults", async () => {
  const introPath = await findSharedIntro();
  return { introPath };
});

ipcMain.handle("paths:auto-detect", async (_event, episodePath: string) => {
  const folder = path.dirname(episodePath);
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const introName = files.find((file) => file.toLowerCase() === "intro.wav");
  const sharedIntroPath = await findSharedIntro();
  const logoName =
    files.find((file) =>
      /welcome to grass valley.*\.(png|jpe?g|webp)$/i.test(file)
    ) ?? files.find((file) => /\.(png|jpe?g|webp)$/i.test(file));

  return {
    introPath: introName ? path.join(folder, introName) : sharedIntroPath,
    logoPath: logoName ? path.join(folder, logoName) : undefined,
    outputDir: defaultProcessedDir(episodePath)
  };
});

ipcMain.handle("shell:open-path", async (_event, targetPath: string) => {
  if (!targetPath) {
    return "No path provided.";
  }
  return shell.openPath(targetPath);
});

ipcMain.handle(
  "processor:start",
  async (
    event,
    settings: ProcessorSettings | BatchProcessorSettings
  ): Promise<{ started: boolean }> => {
    if (activeController) {
      throw new Error("A processing job is already running.");
    }

    activeController = new AbortController();
    const episodePaths = normalizeEpisodePaths(settings);

    void runBatch(settings, episodePaths, (jobEvent) =>
      event.sender.send("processor:event", jobEvent)
    )
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        event.sender.send("processor:event", {
          type: "error",
          step: "processing",
          message
        });
      })
      .finally(() => {
        activeController = undefined;
      });

    return { started: true };
  }
);

ipcMain.handle("processor:cancel", async (): Promise<void> => {
  activeController?.abort();
});

function dialogOptionsFor(kind: FilePickKind): Electron.OpenDialogOptions {
  if (kind === "outputDir") {
    return {
      title: "Choose output folder",
      properties: ["openDirectory", "createDirectory"]
    };
  }

  if (kind === "logo") {
    return {
      title: "Choose logo image",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }
      ]
    };
  }

  return {
    title: kind === "intro" ? "Choose intro WAV" : "Choose episode WAV",
    properties: ["openFile"],
    filters: [{ name: "WAV audio", extensions: ["wav"] }]
  };
}

function normalizeEpisodePaths(
  settings: ProcessorSettings | BatchProcessorSettings
): string[] {
  if ("episodePaths" in settings && settings.episodePaths.length > 0) {
    return [...new Set(settings.episodePaths.filter(Boolean))];
  }
  return settings.episodePath ? [settings.episodePath] : [];
}

async function findSharedIntro(): Promise<string | undefined> {
  const candidates = [
    path.join(app.getAppPath(), "intro.wav"),
    path.join(app.getAppPath(), "assets", "intro.wav"),
    path.join(app.getAppPath(), "Example Episode Processing Folder", "intro.wav"),
    path.join(path.dirname(app.getAppPath()), "intro.wav")
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function runBatch(
  settings: ProcessorSettings | BatchProcessorSettings,
  episodePaths: string[],
  emit: (jobEvent: JobEvent) => void
): Promise<void> {
  if (!activeController) {
    throw new Error("No active processor controller.");
  }
  if (episodePaths.length === 0) {
    throw new Error("Choose at least one episode WAV before starting.");
  }

  emit({
    type: "batch-start",
    total: episodePaths.length,
    message:
      episodePaths.length === 1
        ? "Processing 1 episode"
        : `Processing ${episodePaths.length} episodes`
  });

  for (let index = 0; index < episodePaths.length; index += 1) {
    if (activeController.signal.aborted) {
      throw new Error("Processing was cancelled.");
    }

    const episodePath = episodePaths[index];
    emit({
      type: "batch-item-start",
      index: index + 1,
      total: episodePaths.length,
      episodePath
    });

    const singleSettings: ProcessorSettings = {
      ...settings,
      episodePath,
      episodeNumberOverride:
        episodePaths.length === 1 ? settings.episodeNumberOverride : ""
    };
    delete (singleSettings as Partial<BatchProcessorSettings>).episodePaths;

    const processor = new PodcastProcessor(
      singleSettings,
      (jobEvent) => {
        if (jobEvent.type === "complete") {
          emit({
            type: "batch-item-complete",
            index: index + 1,
            total: episodePaths.length,
            episodePath,
            outputDir: jobEvent.outputDir
          });
          return;
        }
        emit(jobEvent);
      },
      activeController.signal
    );

    await processor.run();
  }

  emit({
    type: "complete",
    outputDir: settings.outputDir || path.dirname(episodePaths[0])
  });
}
