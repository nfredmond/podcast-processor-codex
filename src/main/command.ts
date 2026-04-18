import { spawn } from "node:child_process";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CaptureOptions = {
  cwd?: string;
  input?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  killProcessGroup?: boolean;
};

export type StreamOptions = CaptureOptions & {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

export function captureCommand(
  command: string,
  args: string[],
  options: CaptureOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const detached = Boolean(options.killProcessGroup) && process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let closed = false;
    const abortHandler = () => terminateChild(child.pid, detached, () => closed);

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      closed = true;
      options.signal?.removeEventListener("abort", abortHandler);
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (options.signal?.aborted) {
      abortHandler();
    } else {
      options.signal?.addEventListener("abort", abortHandler, { once: true });
    }

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export function streamCommand(
  command: string,
  args: string[],
  options: StreamOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const detached = Boolean(options.killProcessGroup) && process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let closed = false;
    const abortHandler = () => terminateChild(child.pid, detached, () => closed);

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const consumeLines = (
      chunk: string,
      currentBuffer: string,
      onLine?: (line: string) => void
    ) => {
      const combined = currentBuffer + chunk;
      const lines = combined.split(/\r?\n|\r/);
      const nextBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          onLine?.(line);
        }
      }
      return nextBuffer;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutBuffer = consumeLines(chunk, stdoutBuffer, options.onStdoutLine);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      stderrBuffer = consumeLines(chunk, stderrBuffer, options.onStderrLine);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      closed = true;
      options.signal?.removeEventListener("abort", abortHandler);
      if (stdoutBuffer.trim()) {
        options.onStdoutLine?.(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        options.onStderrLine?.(stderrBuffer);
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (options.signal?.aborted) {
      abortHandler();
    } else {
      options.signal?.addEventListener("abort", abortHandler, { once: true });
    }

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

function terminateChild(
  pid: number | undefined,
  detached: boolean,
  isClosed: () => boolean
): void {
  if (!pid) {
    return;
  }
  const target = detached ? -pid : pid;
  try {
    process.kill(target, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    if (isClosed()) {
      return;
    }
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }, 2500).unref();
}

export async function findCommand(name: string): Promise<string | undefined> {
  const result = await captureCommand("bash", ["-lc", `command -v ${name}`]);
  if (result.code !== 0) {
    return undefined;
  }
  const found = result.stdout.trim().split(/\r?\n/)[0];
  return found || undefined;
}

export function assertSuccess(
  result: CommandResult,
  commandLabel: string
): void {
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${commandLabel} failed${detail ? `: ${detail}` : ""}`);
  }
}
