param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[^@\s]+@[^@\s]+\.[^@\s]+$")]
  [string]$Email
)

$ErrorActionPreference = "Stop"

$escapedEmail = $Email.Replace("'", "''")
$query = "SELECT google_sub, email_verified FROM users WHERE lower(email) = lower('$escapedEmail') AND deleted_at IS NULL LIMIT 2;"
$rawResult = & npx.cmd wrangler d1 execute life-compass-auth --remote --command $query --json 2>&1

if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare D1 could not be queried. Run npx.cmd wrangler login first.`n$($rawResult -join "`n")"
}

try {
  $payload = ($rawResult -join "`n") | ConvertFrom-Json
} catch {
  throw "The Cloudflare D1 response could not be parsed."
}

$rows = @($payload)[0].results
if (@($rows).Count -ne 1) {
  throw "Exactly one matching Google account was not found in D1. Sign in to Life Compass with Google first."
}

$owner = @($rows)[0]
if ($owner.email_verified -ne 1 -or [string]::IsNullOrWhiteSpace($owner.google_sub)) {
  throw "The Google account is not verified or has no stable subject identifier."
}

$owner.google_sub | & npx.cmd wrangler secret put OWNER_GOOGLE_SUB
if ($LASTEXITCODE -ne 0) {
  throw "The owner identifier could not be stored as a Cloudflare Secret."
}

Write-Host "Owner test account configured: $Email"
Write-Host "The stable Google identifier was not printed or written to a project file."
