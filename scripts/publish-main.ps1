param(
  [string]$Message = "Update Life Compass"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PushRepo = Join-Path $Root ".deploy-push"
$ExcludePrefixes = @(
  ".deploy-push/",
  "dist/",
  "node_modules/",
  ".git/"
)

if (-not (Test-Path (Join-Path $PushRepo ".git"))) {
  throw ".deploy-push が見つかりません。先に GitHub から clone した送信用フォルダを用意してください。"
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $gitArgs = @("-C", $PushRepo, "-c", "safe.directory=$PushRepo") + $Args
  & git @gitArgs
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') が失敗しました。"
  }
}

function Invoke-RootGit {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $gitArgs = @("-C", $Root, "-c", "safe.directory=$Root") + $Args
  $output = & git @gitArgs
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') が失敗しました。"
  }
  return $output
}

function Normalize-RepoPath {
  param([string]$Path)
  return $Path -replace "\\", "/"
}

function Test-PublishPath {
  param([string]$Path)
  $normalized = Normalize-RepoPath $Path
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return $false
  }
  foreach ($Prefix in $ExcludePrefixes) {
    if ($normalized.StartsWith($Prefix)) {
      return $false
    }
  }
  return $true
}

Invoke-Git fetch origin
Invoke-Git pull --rebase origin main

$TrackedChanges = Invoke-RootGit diff --name-only
$UntrackedChanges = Invoke-RootGit ls-files --others --exclude-standard
$Files = @($TrackedChanges + $UntrackedChanges) |
  ForEach-Object { Normalize-RepoPath $_ } |
  Where-Object { Test-PublishPath $_ } |
  Sort-Object -Unique

if ($Files.Count -eq 0) {
  Write-Host "GitHubへ送る変更はありません。"
  exit 0
}

foreach ($File in $Files) {
  $Source = Join-Path $Root $File
  $Destination = Join-Path $PushRepo $File
  if (Test-Path -LiteralPath $Source) {
    $DestinationDir = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $DestinationDir)) {
      New-Item -ItemType Directory -Path $DestinationDir | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
  elseif (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Force
  }
}

Push-Location $PushRepo
try {
  & npm.cmd run test:logic
  if ($LASTEXITCODE -ne 0) {
    throw "計算ロジックのテストに失敗しました。"
  }

  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "ビルドに失敗しました。"
  }
}
finally {
  Pop-Location
}

Invoke-Git add $Files

$gitDiffArgs = @("-C", $PushRepo, "-c", "safe.directory=$PushRepo", "diff", "--cached", "--quiet")
& git @gitDiffArgs
if ($LASTEXITCODE -eq 0) {
  Write-Host "GitHubへ送る変更はありません。"
  exit 0
}

Invoke-Git commit -m $Message
Invoke-Git push origin main

Write-Host "GitHub main へ反映しました。Cloudflare の自動デプロイを確認してください。"
