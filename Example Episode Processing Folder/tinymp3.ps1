# WAV to Low Quality MP3 Converter for AI Transcription
# Converts WAV files in the current directory to ~64kbps MP3

# Get the directory where the script is located
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find all WAV files in the script directory
$wavFiles = Get-ChildItem -Path $scriptDir -Filter "*.wav"

if ($wavFiles.Count -eq 0) {
    Write-Host "No WAV files found in the script directory." -ForegroundColor Yellow
    exit
}

# Check if FFmpeg is available
$ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpegPath) {
    Write-Host "ERROR: FFmpeg is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install FFmpeg from: https://ffmpeg.org/download.html" -ForegroundColor Yellow
    exit
}

Write-Host "Found $($wavFiles.Count) WAV file(s) to convert" -ForegroundColor Green
Write-Host "Using FFmpeg at: $ffmpegPath" -ForegroundColor Cyan
Write-Host ""

foreach ($wavFile in $wavFiles) {
    $inputPath = $wavFile.FullName
    $outputPath = Join-Path $scriptDir "$($wavFile.BaseName)_transcribe.mp3"
    
    Write-Host "Converting: $($wavFile.Name)" -ForegroundColor Yellow
    Write-Host "  Input size: $([math]::Round($wavFile.Length / 1MB, 2)) MB"
    
    # Convert to 64kbps mono MP3 for maximum compression
    # -ac 1: Convert to mono
    # -ar 16000: 16kHz sample rate (sufficient for speech)
    # -b:a 64k: 64kbps bitrate
    # -q:a 9: Lower quality (0-9, 9 is lowest)
    $ffmpegArgs = @(
        "-i", "`"$inputPath`"",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "64k",
        "-q:a", "9",
        "-y",
        "`"$outputPath`""
    )
    
    $process = Start-Process -FilePath $ffmpegPath -ArgumentList $ffmpegArgs -Wait -NoNewWindow -PassThru
    
    if ($process.ExitCode -eq 0 -and (Test-Path $outputPath)) {
        $outputSize = (Get-Item $outputPath).Length
        $compressionRatio = [math]::Round(($wavFile.Length / $outputSize), 1)
        $outputSizeMB = [math]::Round($outputSize / 1MB, 2)
        Write-Host "  SUCCESS! Output size: $outputSizeMB MB ($compressionRatio`x compression)" -ForegroundColor Green
    } else {
        Write-Host "  FAILED - Conversion failed!" -ForegroundColor Red
    }
    Write-Host ""
}

Write-Host "All conversions complete!" -ForegroundColor Green
