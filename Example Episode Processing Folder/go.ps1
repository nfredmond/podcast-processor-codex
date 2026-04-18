<#
.SYNOPSIS
    Welcome to Grass Valley - Podcast Episode Processor
.DESCRIPTION
    Automated processing for "Welcome to Grass Valley" podcast hosted by Ryan Doty and Nathaniel Redmond.
    Creates MP4 for YouTube and WAV for Spotify, transcribes audio, and generates episode synopsis.
.PARAMETER SkipAI
    Skip transcription and synopsis generation, only create media files
.PARAMETER GPU
    Use NVIDIA GPU acceleration (requires RTX/GTX GPU with NVENC)
.EXAMPLE
    .\go.ps1 -GPU
#>

[CmdletBinding()]
param(
    [switch]$SkipAI,
    [switch]$GPU
)

$ErrorActionPreference = 'Stop'

# Podcast Info
$PODCAST_NAME = "Welcome to Grass Valley"
$HOSTS = "Ryan Doty and Nathaniel Redmond"

#region FFmpeg Setup

function Find-UnblockFFmpeg {
    <#
    .SYNOPSIS
        Finds and unblocks ffmpeg/ffprobe executables
    .DESCRIPTION
        Automatically detects and unblocks ffmpeg tools blocked by Windows Application Control
    #>
    
    $tools = @('ffmpeg', 'ffprobe')
    $allGood = $true
    
    foreach ($tool in $tools) {
        try {
            $cmd = Get-Command $tool -ErrorAction SilentlyContinue
            
            if (-not $cmd) {
                Write-Host "  [!!] $tool.exe not found in PATH" -ForegroundColor Red
                Write-Host "      Install from: https://ffmpeg.org/download.html" -ForegroundColor Gray
                $allGood = $false
                continue
            }
            
            $exePath = $cmd.Source
            
            # Try to unblock the file
            try {
                Unblock-File -Path $exePath -ErrorAction Stop
            }
            catch {
                # Already unblocked or can't unblock (needs admin)
            }
        }
        catch {
            Write-Host "  [!!] Error checking $tool : $($_.Exception.Message)" -ForegroundColor Red
            $allGood = $false
        }
    }
    
    return $allGood
}

#endregion

# Color output helpers - SLEEK & MODERN
function Write-Status($message) { 
    Write-Host "  [OK] " -NoNewline -ForegroundColor Green
    Write-Host $message -ForegroundColor White 
}

function Write-Info($message) { 
    Write-Host "  [>>] " -NoNewline -ForegroundColor Cyan
    Write-Host $message -ForegroundColor Gray 
}

function Write-Error($message) { 
    Write-Host "  [!!] " -NoNewline -ForegroundColor Red
    Write-Host $message -ForegroundColor White 
}

# Header
Clear-Host
Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    Welcome to Grass Valley" -ForegroundColor White
Write-Host "    Podcast Episode Processor v2.1" -ForegroundColor Gray
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    Hosts: Ryan Doty & Nathaniel Redmond" -ForegroundColor DarkGray
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

if ($GPU) {
    Write-Host "  [GPU] NVIDIA Hardware Acceleration ENABLED" -ForegroundColor Green
    Write-Host ""
}

# Check and unblock FFmpeg tools
Write-Info "Checking FFmpeg tools..."
if (-not (Find-UnblockFFmpeg)) {
    Write-Host ""
    Write-Host "  FFmpeg installation issue detected." -ForegroundColor Yellow
    Write-Host "  Please install FFmpeg or run PowerShell as Administrator to unblock files." -ForegroundColor Gray
    Write-Host ""
    exit 1
}
Write-Host ""

#region Quality Selection

Write-Host "  Select output quality:" -ForegroundColor White
Write-Host ""

if ($GPU) {
    # GPU presets
    Write-Host "    1  Fastest         1080p | p1 (fastest)     | ~10-15x speed" -ForegroundColor DarkGray
    Write-Host "    2  Fast            1080p | p3 (fast)        | ~8-10x speed" -ForegroundColor Gray
    Write-Host "    3  Balanced        1080p | p5 (medium)      | ~6-8x speed" -ForegroundColor White
    Write-Host "    4  High Quality    1080p | p6 (slow)        | ~4-6x speed" -ForegroundColor Gray
    Write-Host "    5  Maximum         1080p | p7 (best)        | ~3-5x speed" -ForegroundColor DarkGray
} else {
    # CPU presets
    Write-Host "    1  Fast Preview    720p  | ultrafast        | Quick test" -ForegroundColor DarkGray
    Write-Host "    2  Balanced        1080p | veryfast         | Good quality" -ForegroundColor Gray
    Write-Host "    3  High Quality    1080p | medium           | Recommended" -ForegroundColor White
    Write-Host "    4  Maximum         1080p | slow             | Best quality" -ForegroundColor Gray
    Write-Host "    5  Ultra HD        2160p | medium           | 4K output" -ForegroundColor DarkGray
}

Write-Host ""

do {
    $qualityChoice = Read-Host "  Choose quality [1-5] (default: 3)"
    if ([string]::IsNullOrWhiteSpace($qualityChoice)) {
        $qualityChoice = "3"
    }
    $qualityNum = [int]$qualityChoice
} while ($qualityNum -lt 1 -or $qualityNum -gt 5)

# Set parameters based on quality choice and GPU mode
if ($GPU) {
    # GPU encoding parameters
    switch ($qualityNum) {
        1 { 
            $Resolution = '1080'
            $Preset = 'p1'
            $Cq = 28
            $Fps = '30'
            $QualityName = "Fastest (GPU)"
        }
        2 { 
            $Resolution = '1080'
            $Preset = 'p3'
            $Cq = 25
            $Fps = '30'
            $QualityName = "Fast (GPU)"
        }
        3 { 
            $Resolution = '1080'
            $Preset = 'p5'
            $Cq = 23
            $Fps = '30'
            $QualityName = "Balanced (GPU)"
        }
        4 { 
            $Resolution = '1080'
            $Preset = 'p6'
            $Cq = 21
            $Fps = '30'
            $QualityName = "High Quality (GPU)"
        }
        5 { 
            $Resolution = '1080'
            $Preset = 'p7'
            $Cq = 19
            $Fps = '30'
            $QualityName = "Maximum (GPU)"
        }
    }
} else {
    # CPU encoding parameters
    switch ($qualityNum) {
        1 { 
            $Resolution = '720'
            $Preset = 'ultrafast'
            $Crf = 28
            $Fps = '30'
            $QualityName = "Fast Preview"
        }
        2 { 
            $Resolution = '1080'
            $Preset = 'veryfast'
            $Crf = 23
            $Fps = '30'
            $QualityName = "Balanced"
        }
        3 { 
            $Resolution = '1080'
            $Preset = 'medium'
            $Crf = 20
            $Fps = '30'
            $QualityName = "High Quality"
        }
        4 { 
            $Resolution = '1080'
            $Preset = 'slow'
            $Crf = 18
            $Fps = '30'
            $QualityName = "Maximum"
        }
        5 { 
            $Resolution = '2160'
            $Preset = 'medium'
            $Crf = 20
            $Fps = '30'
            $QualityName = "Ultra HD (4K)"
        }
    }
}

$AudioBitrate = '192k'

Write-Host ""
Write-Status "Quality: $QualityName"
Write-Host ""

#endregion

#region File Detection & Selection

Write-Info "Scanning for media files..."

# Check for intro.wav first
$introWav = Get-ChildItem -Filter "intro.wav" -File -ErrorAction SilentlyContinue
$hasIntro = $null -ne $introWav
if ($hasIntro) {
    # Try to get duration with ffprobe, but don't fail if Application Control blocks it
    try {
        $introDuration = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $introWav.FullName 2>&1
        
        if ($LASTEXITCODE -eq 0 -and $introDuration) {
            Write-Status "Found intro: intro.wav (~$([math]::Round([double]$introDuration, 1))s)"
        }
        else {
            Write-Status "Found intro: intro.wav (duration check skipped)"
            Write-Host "    Note: ffprobe blocked by Application Control - continuing anyway" -ForegroundColor Yellow
        }
    }
    catch {
        # ffprobe is blocked - just note intro exists and continue
        Write-Status "Found intro: intro.wav (duration check skipped)"
        Write-Host "    Note: ffprobe blocked by Application Control - continuing anyway" -ForegroundColor Yellow
    }
}

# Find WAV files (excluding intro.wav)
$wavFiles = Get-ChildItem -Filter "*.wav" -File | Where-Object { $_.Name -ne "intro.wav" }
if ($wavFiles.Count -eq 0) {
    Write-Error "No episode WAV files found in current directory"
    exit 1
}

$selectedWav = $null
if ($wavFiles.Count -eq 1) {
    $selectedWav = $wavFiles[0]
    Write-Status "Found episode: $($selectedWav.Name)"
} else {
    Write-Host ""
    Write-Host "  Multiple WAV files found:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $wavFiles.Count; $i++) {
        Write-Host "    [$($i+1)] $($wavFiles[$i].Name)"
    }
    Write-Host ""
    do {
        $choice = Read-Host "  Select episode WAV [1-$($wavFiles.Count)]"
        $choiceNum = [int]$choice
    } while ($choiceNum -lt 1 -or $choiceNum -gt $wavFiles.Count)
    $selectedWav = $wavFiles[$choiceNum - 1]
    Write-Status "Selected: $($selectedWav.Name)"
}

# Find image files
$imageFiles = Get-ChildItem -File | Where-Object { $_.Extension -match '\.(png|jpg|jpeg)$' }
if ($imageFiles.Count -eq 0) {
    Write-Error "No image files found (.png, .jpg, .jpeg)"
    exit 1
}

$selectedImage = $null
if ($imageFiles.Count -eq 1) {
    $selectedImage = $imageFiles[0]
    Write-Status "Found image: $($selectedImage.Name)"
} else {
    Write-Host ""
    Write-Host "  Multiple images found:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $imageFiles.Count; $i++) {
        Write-Host "    [$($i+1)] $($imageFiles[$i].Name)"
    }
    Write-Host ""
    do {
        $choice = Read-Host "  Select image [1-$($imageFiles.Count)]"
        $choiceNum = [int]$choice
    } while ($choiceNum -lt 1 -or $choiceNum -gt $imageFiles.Count)
    $selectedImage = $imageFiles[$choiceNum - 1]
    Write-Status "Selected: $($selectedImage.Name)"
}

# Extract episode number from filename if possible
$episodeNumber = "XX"
if ($selectedWav.Name -match '#(\d+)') {
    $episodeNumber = $matches[1]
}

# Create Processed Files folder
$processedFolder = Join-Path $PWD "Processed Files"
if (-not (Test-Path $processedFolder)) {
    New-Item -ItemType Directory -Path $processedFolder | Out-Null
    Write-Status "Created output folder: Processed Files"
}

# Define base name and temp file
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($selectedWav.Name)
$tempConcatWav = $null

# Prepare audio file for processing (with or without intro)
$audioForProcessing = $selectedWav.FullName

if ($hasIntro) {
    Write-Info "Merging intro with episode audio..."
    $tempConcatWav = Join-Path $env:TEMP "$baseName-with-intro.wav"
    
    $concatArgs = @(
        '-y'
        '-i', $introWav.FullName
        '-i', $selectedWav.FullName
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]'
        '-map', '[out]'
        '-loglevel', 'error'
        $tempConcatWav
    )
    
    & ffmpeg @concatArgs 2>&1 | Out-Null
    
    if (Test-Path $tempConcatWav) {
        Write-Status "Audio merged successfully"
        $audioForProcessing = $tempConcatWav
    }
    else {
        Write-Error "Failed to merge intro with episode"
        exit 1
    }
}

#endregion

#region FFmpeg Installation Check

Write-Info "Checking for ffmpeg..."

$ffmpegPath = $null
try {
    $ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
}
catch { }

if (-not $ffmpegPath) {
    Write-Host "  FFmpeg not found. Attempting installation via winget..." -ForegroundColor Yellow
    
    # Check if winget is available
    $wingetPath = $null
    try {
        $wingetPath = (Get-Command winget -ErrorAction SilentlyContinue).Source
    }
    catch { }
    
    if ($wingetPath) {
        Write-Info "Installing ffmpeg..."
        try {
            $installed = $false
            $packageIds = @('Gyan.FFmpeg', 'ffmpeg', 'FFmpeg.FFmpeg')
            
            foreach ($pkgId in $packageIds) {
                try {
                    Write-Host "    Trying $pkgId..." -ForegroundColor Gray
                    winget install $pkgId --silent --accept-source-agreements --accept-package-agreements 2>$null
                    if ($LASTEXITCODE -eq 0) {
                        $installed = $true
                        Write-Status "FFmpeg installed successfully"
                        Write-Info "Refreshing PATH..."
                        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
                        break
                    }
                }
                catch { continue }
            }
            
            if (-not $installed) {
                throw "Installation failed"
            }
            
            Start-Sleep -Seconds 2
            $ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
            if (-not $ffmpegPath) {
                throw "FFmpeg installed but not found in PATH. Please restart your terminal."
            }
        }
        catch {
            Write-Error "FFmpeg installation failed"
            Write-Host ""
            Write-Host "  Manual installation:" -ForegroundColor Yellow
            Write-Host "    1. Download: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor White
            Write-Host "    2. Extract to C:\ffmpeg" -ForegroundColor White
            Write-Host "    3. Add C:\ffmpeg\bin to PATH" -ForegroundColor White
            exit 1
        }
    }
    else {
        Write-Error "Winget not found. Cannot auto-install ffmpeg."
        Write-Host ""
        Write-Host "  Please install ffmpeg manually:" -ForegroundColor Yellow
        Write-Host "    Download: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor White
        exit 1
    }
}
else {
    Write-Status "FFmpeg ready: $ffmpegPath"
}

# Test GPU encoding support if GPU flag is set
if ($GPU) {
    Write-Info "Testing NVIDIA GPU encoder..."
    $gpuTest = & ffmpeg -hide_banner -encoders 2>&1 | Select-String "h264_nvenc"
    if ($gpuTest) {
        Write-Status "NVIDIA NVENC encoder available"
    } else {
        Write-Host ""
        Write-Host "  WARNING: NVIDIA encoder not found!" -ForegroundColor Yellow
        Write-Host "  Make sure you have:" -ForegroundColor Yellow
        Write-Host "    - NVIDIA GPU drivers installed" -ForegroundColor White
        Write-Host "    - FFmpeg built with NVENC support" -ForegroundColor White
        Write-Host ""
        Write-Host "  Falling back to CPU encoding..." -ForegroundColor Yellow
        Write-Host ""
        $GPU = $false
        Start-Sleep -Seconds 3
    }
}

#endregion

#region MP4 Generation

Write-Host ""
Write-Host "  -----------------------------------------------" -ForegroundColor DarkCyan
if ($GPU) {
    Write-Host "   Creating MP4 for YouTube (GPU Accelerated)" -ForegroundColor White
} else {
    Write-Host "   Creating MP4 for YouTube" -ForegroundColor White
}
Write-Host "  -----------------------------------------------" -ForegroundColor DarkCyan
Write-Host ""

# Get audio duration for progress bar (optional - skip if ffprobe blocked)
$audioDuration = $null
try {
    $audioDuration = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $audioForProcessing 2>&1
    if ($LASTEXITCODE -ne 0) {
        $audioDuration = $null
    }
}
catch {
    $audioDuration = $null
}

# Calculate dimensions based on resolution
$width = switch ($Resolution) {
    '720'  { 1280 }
    '1080' { 1920 }
    '2160' { 3840 }
}
$height = switch ($Resolution) {
    '720'  { 720 }
    '1080' { 1080 }
    '2160' { 2160 }
}

if ($GPU) {
    Write-Info "Encoder: NVIDIA NVENC (h264_nvenc)"
    Write-Info "Resolution: ${width}x${height}, FPS: $Fps, CQ: $Cq"
    Write-Info "Preset: $Preset"
} else {
    Write-Info "Encoder: CPU (libx264)"
    Write-Info "Resolution: ${width}x${height}, FPS: $Fps, CRF: $Crf"
    Write-Info "Preset: $Preset"
}

if ($audioDuration) {
    Write-Info "Duration: $([math]::Round([double]$audioDuration / 60, 1)) minutes"
}
else {
    Write-Info "Duration: (unavailable - ffprobe blocked)"
}

# Build video filter string
$videoFilter = "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"

# Temporary MP4 path
$tempMp4 = Join-Path $env:TEMP "$baseName-temp.mp4"

# Create a temporary progress log file
$progressLog = Join-Path $env:TEMP "ffmpeg-progress-$([guid]::NewGuid()).log"

# Build ffmpeg arguments based on GPU or CPU mode
if ($GPU) {
    # GPU encoding with NVENC - optimized for static image
    $ffmpegArgs = @(
        '-y'
        '-loop', '1'
        '-framerate', $Fps
        '-i', $selectedImage.FullName
        '-i', $audioForProcessing
        '-vf', $videoFilter
        '-c:v', 'h264_nvenc'
        '-preset', $Preset
        '-tune', 'hq'
        '-rc', 'constqp'
        '-qp', $Cq
        '-r', $Fps
        '-bf', '0'
        '-c:a', 'aac'
        '-b:a', $AudioBitrate
        '-shortest'
        '-movflags', '+faststart'
        '-progress', $progressLog
        '-nostats'
        '-loglevel', 'error'
        $tempMp4
    )
} else {
    # CPU encoding with libx264
    $ffmpegArgs = @(
        '-y'
        '-loop', '1'
        '-i', $selectedImage.FullName
        '-i', $audioForProcessing
        '-vf', $videoFilter
        '-c:v', 'libx264'
        '-preset', $Preset
        '-crf', $Crf
        '-r', $Fps
        '-c:a', 'aac'
        '-b:a', $AudioBitrate
        '-shortest'
        '-movflags', '+faststart'
        '-progress', $progressLog
        '-nostats'
        '-loglevel', 'error'
        $tempMp4
    )
}

Write-Host ""
Write-Info "Encoding video..."
Write-Host ""

try {
    # Start ffmpeg in background job
    $job = Start-Job -ScriptBlock {
        param($ffmpegArgs)
        & ffmpeg @ffmpegArgs 2>&1
    } -ArgumentList (,$ffmpegArgs)
    
    $startTime = Get-Date
    $lastUpdate = Get-Date
    
    # Monitor progress
    while ($job.State -eq 'Running') {
        Start-Sleep -Milliseconds 500
        
        if ((Test-Path $progressLog) -and ((Get-Date) - $lastUpdate).TotalMilliseconds -ge 500) {
            $lastUpdate = Get-Date
            
            try {
                $progressContent = Get-Content $progressLog -Tail 20 -ErrorAction SilentlyContinue
                $timeLine = $progressContent | Where-Object { $_ -match '^out_time_ms=(\d+)' } | Select-Object -Last 1
                
                if ($timeLine -match '^out_time_ms=(\d+)') {
                    $currentMicroseconds = [long]$matches[1]
                    $currentSeconds = $currentMicroseconds / 1000000.0
                    $totalSeconds = if ($audioDuration) { [double]$audioDuration } else { 0 }
                    
                    if ($totalSeconds -gt 0) {
                        $percent = [math]::Min(100, [math]::Round(($currentSeconds / $totalSeconds) * 100, 1))
                        
                        # Calculate time info
                        $elapsed = (Get-Date) - $startTime
                        $speed = if ($currentSeconds -gt 0) { $currentSeconds / $elapsed.TotalSeconds } else { 0 }
                        $remaining = if ($speed -gt 0 -and $currentSeconds -lt $totalSeconds) { 
                            [TimeSpan]::FromSeconds(($totalSeconds - $currentSeconds) / $speed) 
                        } else { 
                            [TimeSpan]::Zero 
                        }
                        
                        # Build progress bar
                        $barWidth = 40
                        $completed = [math]::Floor($barWidth * ($percent / 100))
                        $remaining_bar = $barWidth - $completed
                        $bar = ('#' * $completed) + ('.' * $remaining_bar)
                        
                        # Format time strings
                        $elapsedStr = "{0:mm}:{0:ss}" -f $elapsed
                        $remainingStr = if ($remaining.TotalSeconds -gt 0) { "{0:mm}:{0:ss}" -f $remaining } else { "00:00" }
                        $speedStr = "{0:0.0}x" -f $speed
                        
                        # Progress string
                        $progressStr = "  [$bar] $percent% | $elapsedStr elapsed | $remainingStr left | $speedStr"
                        
                        Write-Host "`r$progressStr     " -NoNewline -ForegroundColor Cyan
                    }
                    else {
                        # Show simple elapsed time when duration unavailable
                        $elapsed = (Get-Date) - $startTime
                        $elapsedStr = "{0:mm}:{0:ss}" -f $elapsed
                        $currentTimeStr = [TimeSpan]::FromSeconds($currentSeconds).ToString("mm\:ss")
                        $progressStr = "  Encoding... | $currentTimeStr processed | $elapsedStr elapsed"
                        Write-Host "`r$progressStr     " -NoNewline -ForegroundColor Cyan
                    }
                }
            }
            catch { }
        }
    }
    
    Write-Host ""
    Write-Host ""
    
    # Wait for job to complete
    $jobResult = Receive-Job -Job $job -Wait -ErrorAction SilentlyContinue
    Remove-Job -Job $job -Force
    
    # Clean up progress log
    if (Test-Path $progressLog) {
        Remove-Item $progressLog -Force -ErrorAction SilentlyContinue
    }
    
    if (Test-Path $tempMp4) {
        $mp4Size = (Get-Item $tempMp4).Length / 1MB
        $mp4SizeStr = [math]::Round($mp4Size, 2).ToString() + " MB"
        Write-Status "MP4 created successfully ($mp4SizeStr)"
    }
    else {
        if ($jobResult) {
            Write-Host "  FFmpeg output:" -ForegroundColor Red
            $jobResult | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
        }
        throw "MP4 creation failed"
    }
}
catch {
    Write-Error "Encoding failed: $_"
    if (Test-Path $progressLog) {
        Remove-Item $progressLog -Force -ErrorAction SilentlyContinue
    }
    if ($tempConcatWav) {
        Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
    }
    exit 1
}

#endregion

#region AI Processing

$transcript = ""
$synopsis = ""
$episodeTitle = ""

if (-not $SkipAI) {
    Write-Host ""
    Write-Host "  -----------------------------------------------" -ForegroundColor DarkMagenta
    Write-Host "   AI Processing" -ForegroundColor White
    Write-Host "  -----------------------------------------------" -ForegroundColor DarkMagenta
    Write-Host ""
    
    # Check for API key
    $apiKey = $env:OPENAI_API_KEY
    if (-not $apiKey) {
        Write-Error "OPENAI_API_KEY environment variable not set"
        Write-Host ""
        Write-Host "  Set temporarily (current session):" -ForegroundColor Yellow
        Write-Host '    $env:OPENAI_API_KEY = "sk-your-key"' -ForegroundColor White
        Write-Host ""
        Write-Host "  Set permanently (all sessions):" -ForegroundColor Yellow
        Write-Host '    setx OPENAI_API_KEY "sk-your-key"' -ForegroundColor White
        Write-Host '    (Then restart PowerShell)' -ForegroundColor Gray
        Write-Host ""
        if ($tempConcatWav) {
            Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $tempMp4 -Force -ErrorAction SilentlyContinue
        exit 1
    }
    
    Write-Status "API key found"
    
    # Check if we have audio duration
    if (-not $audioDuration) {
        Write-Host ""
        Write-Host "  [!!] Cannot determine audio duration (ffprobe blocked)" -ForegroundColor Yellow
        Write-Host "      Transcription will use default settings" -ForegroundColor Gray
        Write-Host ""
    }
    
    # Convert audio to temporary MP3
    $tempMp3 = Join-Path $env:TEMP "$baseName-temp.mp3"
    Write-Info "Preparing audio for transcription..."
    
    # Calculate bitrate to stay under 25MB limit
    if ($audioDuration) {
        $durationSeconds = [double]$audioDuration
        $maxBytes = 25 * 1024 * 1024  # 25MB limit
        $targetBitrate = [math]::Floor(($maxBytes * 8) / $durationSeconds / 1000)  # in kbps
        $targetBitrate = [math]::Max(16, [math]::Min($targetBitrate, 32))  # Clamp between 16-32 kbps
        
        $durationMinutes = [math]::Round($durationSeconds / 60, 1)
        Write-Host "    Duration: $durationMinutes min | Using ${targetBitrate}k bitrate" -ForegroundColor Gray
    }
    else {
        # Use conservative bitrate when duration unknown
        $targetBitrate = 24  # Safe middle ground
        Write-Host "    Duration: unknown | Using ${targetBitrate}k bitrate (conservative)" -ForegroundColor Gray
    }
    
    $mp3Args = @(
        '-y'
        '-i', $audioForProcessing
        '-vn'
        '-ar', '16000'
        '-ac', '1'
        '-b:a', "${targetBitrate}k"
        '-loglevel', 'error'
        $tempMp3
    )
    
    & ffmpeg @mp3Args 2>&1 | Out-Null
    
    if (Test-Path $tempMp3) {
        $mp3Size = (Get-Item $tempMp3).Length / 1MB
        $mp3SizeRounded = [math]::Round($mp3Size, 2)
        
        # Check if still too large
        if ($mp3Size -gt 25) {
            $mp3SizeStr = $mp3SizeRounded.ToString() + " MB"
            Write-Error "File too large for Whisper API ($mp3SizeStr)"
            Write-Host ""
            Write-Host "  Options:" -ForegroundColor Yellow
            Write-Host "    - Use -SkipAI flag to skip transcription" -ForegroundColor White
            Write-Host "    - Split episode into shorter segments" -ForegroundColor White
            Write-Host ""
            if ($tempConcatWav) {
                Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
            }
            Remove-Item $tempMp4 -Force -ErrorAction SilentlyContinue
            Remove-Item $tempMp3 -Force -ErrorAction SilentlyContinue
            exit 1
        }
        
        $mp3SizeStr = $mp3SizeRounded.ToString() + " MB"
        Write-Status "Audio prepared ($mp3SizeStr)"
    }
    else {
        Write-Error "MP3 conversion failed"
        if ($tempConcatWav) {
            Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $tempMp4 -Force -ErrorAction SilentlyContinue
        exit 1
    }
    
    # Transcribe audio
    Write-Info "Transcribing with OpenAI Whisper..."
    $mp3SizeStr = $mp3SizeRounded.ToString() + " MB"
    Write-Host "    Uploading $mp3SizeStr (this may take a few minutes)" -ForegroundColor Gray
    
    try {
        # Prepare multipart form data
        $boundary = [System.Guid]::NewGuid().ToString()
        $LF = "`r`n"
        
        $fileBytes = [System.IO.File]::ReadAllBytes($tempMp3)
        $fileName = [System.IO.Path]::GetFileName($tempMp3)
        
        $bodyLines = @(
            "--$boundary",
            "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"",
            "Content-Type: audio/mpeg",
            "",
            [System.Text.Encoding]::GetEncoding('ISO-8859-1').GetString($fileBytes),
            "--$boundary",
            "Content-Disposition: form-data; name=`"model`"",
            "",
            "whisper-1",
            "--$boundary--"
        ) -join $LF
        
        $bodyBytes = [System.Text.Encoding]::GetEncoding('ISO-8859-1').GetBytes($bodyLines)
        
        $headers = @{
            'Authorization' = "Bearer $apiKey"
            'Content-Type' = "multipart/form-data; boundary=$boundary"
        }
        
        $response = Invoke-RestMethod -Uri 'https://api.openai.com/v1/audio/transcriptions' `
            -Method Post `
            -Headers $headers `
            -Body $bodyBytes
        
        $transcript = $response.text
        
        Write-Status "Transcript complete ($($transcript.Length) characters)"
        
        # Clean up temp MP3
        Remove-Item $tempMp3 -Force -ErrorAction SilentlyContinue
        
    }
    catch {
        Write-Error "Transcription failed: $($_.Exception.Message)"
        if ($_.ErrorDetails) {
            Write-Host "    $($_.ErrorDetails.Message)" -ForegroundColor Red
        }
        Remove-Item $tempMp3 -Force -ErrorAction SilentlyContinue
        if ($tempConcatWav) {
            Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $tempMp4 -Force -ErrorAction SilentlyContinue
        exit 1
    }
    
    # Generate episode title
    Write-Info "Generating episode title..."
    
    try {
        $transcriptForTitle = if ($transcript.Length -gt 8000) {
            $transcript.Substring(0, 8000)
        } else {
            $transcript
        }
        
        $titleSystemPrompt = "You are a podcast filename generator for `"Welcome to Grass Valley`" hosted by Ryan Doty and Nathaniel Redmond. Create a concise, descriptive filename suffix based on the transcript. Format: `"Guest Name on Topic`" or `"Guest Name - Brief Description`". Examples: `"Matt Collins on Local MMA Training`", `"Julia Tracey - Historical Fiction Writing`". Rules: Maximum 50 characters, focus on guest name and main topic, no special characters except hyphens and spaces, be specific but concise."
        
        $titleUserPrompt = "Based on this transcript excerpt, create a filename suffix in the format `"Guest Name on Topic`": $transcriptForTitle"
        
        $titleBody = @{
            model = 'gpt-4o'
            messages = @(
                @{
                    role = 'system'
                    content = $titleSystemPrompt
                },
                @{
                    role = 'user'
                    content = $titleUserPrompt
                }
            )
            temperature = 0.3
            max_tokens = 50
        } | ConvertTo-Json -Depth 10
        
        $headers = @{
            'Authorization' = "Bearer $apiKey"
            'Content-Type' = 'application/json'
        }
        
        $titleResponse = Invoke-RestMethod -Uri 'https://api.openai.com/v1/chat/completions' `
            -Method Post `
            -Headers $headers `
            -Body $titleBody
        
        $episodeTitle = $titleResponse.choices[0].message.content.Trim()
        $episodeTitle = $episodeTitle -replace '"', '' -replace '[\\/:*?<>|]', '-'
        
        Write-Status "Title: $episodeTitle"
        
    }
    catch {
        Write-Host "    Title generation failed - using default" -ForegroundColor Yellow
        $episodeTitle = "Episode"
    }
    
    # Generate synopsis
    Write-Info "Generating synopsis..."
    
    try {
        $maxTranscriptChars = 10000
        $transcriptForSummary = $transcript
        if ($transcript.Length -gt $maxTranscriptChars) {
            $keepChars = [int]($maxTranscriptChars / 2)
            $transcriptForSummary = $transcript.Substring(0, $keepChars) + "`n`n[... middle section omitted ...]`n`n" + $transcript.Substring($transcript.Length - $keepChars)
        }
        
        $systemPrompt = "You are a podcast episode summarizer for `"Welcome to Grass Valley`" hosted by Ryan Doty and Nathaniel Redmond. Create engaging, factual episode descriptions for platforms like Spotify and YouTube. Guidelines: Write EXACTLY ONE paragraph (no bullet points, no headings, no line breaks), Length: 60-110 words, Be engaging but factual - no made-up details, Mention `"Welcome to Grass Valley`" naturally in the description, Focus on key topics and takeaways from the conversation, Write in third person or describe what listeners will hear, Do NOT mention the intro music or opening - focus on the main content."
        
        $userPrompt = "Based on this transcript, write a 60-110 word episode synopsis as one paragraph: $transcriptForSummary"
        
        $body = @{
            model = 'gpt-4o'
            messages = @(
                @{
                    role = 'system'
                    content = $systemPrompt
                },
                @{
                    role = 'user'
                    content = $userPrompt
                }
            )
            temperature = 0.7
            max_tokens = 250
        } | ConvertTo-Json -Depth 10
        
        $headers = @{
            'Authorization' = "Bearer $apiKey"
            'Content-Type' = 'application/json'
        }
        
        $response = Invoke-RestMethod -Uri 'https://api.openai.com/v1/chat/completions' `
            -Method Post `
            -Headers $headers `
            -Body $body
        
        $synopsis = $response.choices[0].message.content.Trim()
        
        Write-Status "Synopsis complete ($($synopsis.Split(' ').Count) words)"
        
        # Display synopsis
        Write-Host ""
        Write-Host "  +----------------------------------------------+" -ForegroundColor DarkGray
        Write-Host "  | Synopsis" -ForegroundColor Gray
        Write-Host "  +----------------------------------------------+" -ForegroundColor DarkGray
        Write-Host ""
        
        # Word wrap synopsis at ~80 chars
        $words = $synopsis -split '\s+'
        $line = "  "
        foreach ($word in $words) {
            if (($line + $word).Length -gt 78) {
                Write-Host $line -ForegroundColor White
                $line = "  $word"
            } else {
                $line += " $word"
            }
        }
        if ($line.Trim()) {
            Write-Host $line -ForegroundColor White
        }
        Write-Host ""
        
    }
    catch {
        Write-Error "Synopsis generation failed: $($_.Exception.Message)"
        $synopsis = "Episode synopsis could not be generated."
    }
    
}
else {
    Write-Host ""
    Write-Host "  AI Processing Skipped" -ForegroundColor Yellow
    Write-Host ""
    $episodeTitle = $baseName
}

#endregion

#region Save Processed Files

Write-Host ""
Write-Host "  -----------------------------------------------" -ForegroundColor DarkBlue
Write-Host "   Saving Files" -ForegroundColor White
Write-Host "  -----------------------------------------------" -ForegroundColor DarkBlue
Write-Host ""

# Generate final filenames
$finalBaseName = "Welcome to Grass Valley #$episodeNumber - $episodeTitle"
$finalBaseName = $finalBaseName -replace '[\\/:*?"<>|]', '-'

$finalMp4Path = Join-Path $processedFolder "$finalBaseName.mp4"
$finalWavPath = Join-Path $processedFolder "$finalBaseName.wav"
$synopsisPath = Join-Path $processedFolder "$finalBaseName - SYNOPSIS.txt"
$transcriptPath = Join-Path $processedFolder "$finalBaseName - TRANSCRIPT.txt"

# Move MP4
Write-Info "Saving MP4..."
Move-Item -Path $tempMp4 -Destination $finalMp4Path -Force
$mp4Size = (Get-Item $finalMp4Path).Length / 1MB
$mp4SizeStr = [math]::Round($mp4Size, 2).ToString() + " MB"
Write-Status "MP4 saved ($mp4SizeStr)"

# Copy WAV
Write-Info "Saving WAV..."
if ($audioForProcessing -ne $selectedWav.FullName) {
    Copy-Item -Path $audioForProcessing -Destination $finalWavPath -Force
} else {
    Copy-Item -Path $selectedWav.FullName -Destination $finalWavPath -Force
}
$wavSize = (Get-Item $finalWavPath).Length / 1MB
$wavSizeStr = [math]::Round($wavSize, 2).ToString() + " MB"
Write-Status "WAV saved ($wavSizeStr)"

# Save synopsis
if (-not [string]::IsNullOrWhiteSpace($synopsis)) {
    $synopsis | Out-File -FilePath $synopsisPath -Encoding UTF8
    Write-Status "Synopsis saved"
    
    try {
        $synopsis | Set-Clipboard
        Write-Status "Synopsis copied to clipboard"
    }
    catch {
        Write-Host "    (Clipboard copy failed)" -ForegroundColor Yellow
    }
}

# Save transcript
if (-not [string]::IsNullOrWhiteSpace($transcript)) {
    $transcript | Out-File -FilePath $transcriptPath -Encoding UTF8
    Write-Status "Transcript saved"
}

#endregion

#region Cleanup

if ($tempConcatWav -and (Test-Path $tempConcatWav)) {
    Remove-Item $tempConcatWav -Force -ErrorAction SilentlyContinue
}

#endregion

#region Summary

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "    Processing Complete" -ForegroundColor White
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""

Write-Host "  Output folder:" -ForegroundColor Gray
Write-Host "    $processedFolder" -ForegroundColor White
Write-Host ""

Write-Host "  Files created:" -ForegroundColor Gray
Write-Host "    - $finalBaseName.mp4" -ForegroundColor Cyan
Write-Host "    - $finalBaseName.wav" -ForegroundColor Cyan

if (-not $SkipAI) {
    Write-Host "    - $finalBaseName - SYNOPSIS.txt" -ForegroundColor Cyan
    Write-Host "    - $finalBaseName - TRANSCRIPT.txt" -ForegroundColor Cyan
}

if ($hasIntro) {
    Write-Host ""
    Write-Host "  Note: Intro merged into both audio files" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor DarkGray
Write-Host "    Welcome to Grass Valley | Episode #$episodeNumber" -ForegroundColor Gray
Write-Host "    Ryan Doty & Nathaniel Redmond" -ForegroundColor DarkGray
Write-Host "  ===============================================" -ForegroundColor DarkGray
Write-Host ""

#endregion