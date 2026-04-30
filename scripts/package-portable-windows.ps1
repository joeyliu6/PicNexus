[CmdletBinding()]
param(
  [ValidateSet('debug', 'release')]
  [string]$Profile = 'release'
)

$ErrorActionPreference = 'Stop'

function Assert-File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label not found: $Path"
  }
}

function Assert-NewerThanSource {
  param(
    [Parameter(Mandatory = $true)][string]$BinaryPath,
    [Parameter(Mandatory = $true)][string[]]$SourcePaths
  )

  $binaryTime = (Get-Item -LiteralPath $BinaryPath).LastWriteTimeUtc
  foreach ($sourcePath in $SourcePaths) {
    $sourceTime = (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc
    if ($binaryTime -lt $sourceTime) {
      throw "Release executable is older than $sourcePath. Run 'npm run tauri build' before packaging the portable ZIP."
    }
  }
}

function Resolve-Sidecar {
  param([Parameter(Mandatory = $true)][string]$BaseName)

  $releaseSidecar = Join-Path $targetDir "$BaseName.exe"
  if (Test-Path -LiteralPath $releaseSidecar -PathType Leaf) {
    return $releaseSidecar
  }

  $bundledSidecar = Join-Path $repoRoot "src-tauri\binaries\$BaseName-x86_64-pc-windows-msvc.exe"
  if (Test-Path -LiteralPath $bundledSidecar -PathType Leaf) {
    return $bundledSidecar
  }

  throw "Sidecar not found: $BaseName"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageJson = Join-Path $repoRoot 'package.json'
$version = (Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8 | ConvertFrom-Json).version

$targetDir = Join-Path $repoRoot "src-tauri\target\$Profile"
$portableRoot = Join-Path $targetDir 'portable'
$stagingDir = Join-Path $portableRoot 'PicNexus'
$zipPath = Join-Path $portableRoot "PicNexus_${version}_windows_x64_portable.zip"

$mainExe = Join-Path $targetDir 'picnexus.exe'
$icon = Join-Path $repoRoot 'src-tauri\icons\icon.png'

Assert-File -Path $mainExe -Label 'Main executable'
Assert-File -Path $icon -Label 'Tray icon'
Assert-NewerThanSource -BinaryPath $mainExe -SourcePaths @(
  (Join-Path $repoRoot 'src-tauri\src\portable.rs'),
  (Join-Path $repoRoot 'src-tauri\src\main.rs'),
  (Join-Path $repoRoot 'src\utils\appPaths.ts'),
  (Join-Path $repoRoot 'src\services\database\HistoryDatabase.ts'),
  (Join-Path $repoRoot 'src\services\database\ConnectionManager.ts')
)

$qiyuSidecar = Resolve-Sidecar -BaseName 'qiyu-token-fetcher'
$namiSidecar = Resolve-Sidecar -BaseName 'nami-token-fetcher'

New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
$resolvedPortableRoot = (Resolve-Path -LiteralPath $portableRoot).Path

if (Test-Path -LiteralPath $stagingDir) {
  $resolvedStagingDir = (Resolve-Path -LiteralPath $stagingDir).Path
  if (-not $resolvedStagingDir.StartsWith($resolvedPortableRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove staging directory outside portable root: $resolvedStagingDir"
  }
  Remove-Item -LiteralPath $resolvedStagingDir -Recurse -Force
}

if (Test-Path -LiteralPath $zipPath) {
  try {
    Remove-Item -LiteralPath $zipPath -Force
  } catch {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $zipPath = Join-Path $portableRoot "PicNexus_${version}_windows_x64_${timestamp}_portable.zip"
    Write-Warning "Existing portable ZIP is locked. Writing to: $zipPath"
  }
}

$binDir = Join-Path $stagingDir 'bin'
$iconsDir = Join-Path $stagingDir 'icons'
$dataDir = Join-Path $stagingDir 'data'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

Copy-Item -LiteralPath $mainExe -Destination (Join-Path $stagingDir 'PicNexus.exe')
Copy-Item -LiteralPath $qiyuSidecar -Destination (Join-Path $binDir 'qiyu-token-fetcher.exe')
Copy-Item -LiteralPath $namiSidecar -Destination (Join-Path $binDir 'nami-token-fetcher.exe')
Copy-Item -LiteralPath $icon -Destination (Join-Path $iconsDir 'icon.png')

@{
  portable = $true
  dataDir = "data"
  cache = "system"
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataDir 'portable.json') -Encoding utf8

@(
  'PicNexus Windows Portable'
  ''
  'Run PicNexus.exe after extracting this folder.'
  ''
  'This is a portable-data build. Settings, upload history, logs, CLI'
  'configuration, and the local encryption key are stored in the data folder.'
  ''
  'Image/browser caches still use the normal Windows cache location by design.'
) | Set-Content -LiteralPath (Join-Path $stagingDir 'README-portable.txt') -Encoding utf8

Compress-Archive -Path $stagingDir -DestinationPath $zipPath -Force

Write-Host "Portable ZIP created: $zipPath"
