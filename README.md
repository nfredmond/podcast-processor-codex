# Welcome to Grass Valley Processor

Linux Mint desktop app for processing podcast episodes.

The app creates:

- a Spotify-ready WAV with the intro added
- a YouTube MP4 with the static logo displayed for the full episode
- a tiny MP3 for local transcription
- a Whisper transcript
- separate Claude Code, Codex CLI, and Ollama Qwen transcript/summary outputs
- a side-by-side summary comparison file with word counts and timings
- optional title-based final MP4/WAV filenames

## Requirements

The app expects these commands to be available in `PATH`:

- `ffmpeg`
- `ffprobe`
- `whisper`
- `claude`
- `codex`
- `ollama`

Ollama should have `qwen3-coder-emergency:latest` installed. The diagnostics panel checks all of this at startup.

The app probes `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, and PATH `ffmpeg`.
It prefers the first FFmpeg that exposes `h264_nvenc`, so Linux Mint can use the
APT FFmpeg for NVIDIA encoding even when another static FFmpeg appears earlier
in PATH.

## Run

Install dependencies:

```bash
npm install
```

Start the desktop app:

```bash
npm run dev
```

Build and launch the production app:

```bash
npm start
```

The local desktop shortcut uses `launch-podcast-processor.sh`, which loads the
same Node/npm environment a terminal would use, builds the app, and opens
Electron. Launcher logs are written to `~/.cache/podcast-processor-codex/launcher.log`.

## Workflow

1. Drop or choose a raw episode WAV.
2. Drop or choose multiple WAVs to process a batch sequentially.
3. The app auto-loads the shared `intro.wav` by default, then prefers an `intro.wav` beside the first selected episode when present. You can still choose a different intro manually.
4. The app auto-detects the podcast logo image and defaults output to `Processed Files` inside the first selected episode's parent folder. That folder is created automatically during processing, and you can choose a different output folder when needed.
5. Choose media outputs, video quality, tiny MP3 bitrate, AI backends, and the primary AI backend for title generation.
6. Process the episode or batch.
7. Open artifacts from the right-side artifact list.

Batch processing runs episodes one at a time so FFmpeg, Whisper, and Ollama do
not fight for GPU or memory. The episode number override is disabled for
multi-episode batches; each episode uses `#NN` from its own filename, or `XX`
when no number is present.

Tiny MP3 bitrate defaults to `Auto under 24 MB`, which calculates a 16-32 kbps
bitrate from the final audio duration. Manual 16/24/32/64 kbps settings are
available when you want fixed output.

When AI and title generation are enabled, the app asks the primary backend for a
filename-safe title and renames final media like:

```text
Welcome to Grass Valley #NN - Guest on Topic.mp4
Welcome to Grass Valley #NN - Guest on Topic.wav
```

If no `#NN` appears in the source filename and no override is entered, the
episode number falls back to `XX`.

The prompts lock the current host spellings as `Maxx` and `Lindsay`.
