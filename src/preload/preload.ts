import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  BatchProcessorSettings,
  Diagnostics,
  FilePickKind,
  JobEvent,
  ProcessorSettings
} from "../shared/types.js";

const api = {
  getDiagnostics: (): Promise<Diagnostics> => ipcRenderer.invoke("diagnostics:get"),
  pickPath: (kind: FilePickKind): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pick", kind),
  pickEpisodePaths: (): Promise<string[]> =>
    ipcRenderer.invoke("dialog:pick-episodes"),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getDefaultOutputDir: (episodePath: string): Promise<string> =>
    ipcRenderer.invoke("paths:default-output-dir", episodePath),
  getSharedDefaults: (): Promise<{ introPath?: string }> =>
    ipcRenderer.invoke("paths:shared-defaults"),
  autoDetectPaths: (
    episodePath: string
  ): Promise<{ introPath?: string; logoPath?: string; outputDir: string }> =>
    ipcRenderer.invoke("paths:auto-detect", episodePath),
  readImageDataUrl: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("file:image-data-url", filePath),
  startJob: (
    settings: ProcessorSettings | BatchProcessorSettings
  ): Promise<{ started: boolean }> =>
    ipcRenderer.invoke("processor:start", settings),
  cancelJob: (): Promise<void> => ipcRenderer.invoke("processor:cancel"),
  openPath: (targetPath: string): Promise<string> =>
    ipcRenderer.invoke("shell:open-path", targetPath),
  onJobEvent: (callback: (event: JobEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, jobEvent: JobEvent) => {
      callback(jobEvent);
    };
    ipcRenderer.on("processor:event", listener);
    return () => ipcRenderer.removeListener("processor:event", listener);
  }
};

contextBridge.exposeInMainWorld("podcast", api);

export type PodcastApi = typeof api;
