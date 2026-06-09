param(
  [string]$Message = "Update Life Compass"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PushRepo = Join-Path $Root ".deploy-push"
$Files = @(
  "src/App.tsx",
  "src/styles.css",
  "src/types.ts",
  "src/utils/calculations.ts",
  "tests/calculations.test.ts"
)

if (-not (Test-Path (Join-Path $PushRepo ".git"))) {
  throw ".deploy-push が見つかりません。先に GitHub から clone した送信用フォルダを用意してください。"
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git -C $PushRepo -c "safe.directory=$PushRepo" @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') が失敗しました。"
  }
}

Invoke-Git fetch origin
Invoke-Git pull --rebase origin main

foreach ($File in $Files) {
  $Source = Join-Path $Root $File
  $Destination = Join-Path $PushRepo $File
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
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

& git -C $PushRepo -c "safe.directory=$PushRepo" diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "GitHubへ送る変更はありません。"
  exit 0
}

Invoke-Git commit -m $Message
Invoke-Git push origin main

Write-Host "GitHub main へ反映しました。Cloudflare の自動デプロイを確認してください。"
