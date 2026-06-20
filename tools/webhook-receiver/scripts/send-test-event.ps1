<#
.SYNOPSIS
  Send a simulated GitHub webhook delivery to the local receiver.

.DESCRIPTION
  Builds a small sample payload, computes the HMAC-SHA256 signature using
  GITHUB_WEBHOOK_SECRET from the local .env file, and POSTs it to the
  receiver. Use this to exercise the receiver end-to-end without exposing
  your laptop to the public internet.

.PARAMETER EventType
  Value sent in the X-GitHub-Event header. Defaults to "ping".

.PARAMETER DeliveryId
  Value sent in the X-GitHub-Delivery header. Defaults to a new GUID.
  Pass the SAME value twice to verify deduplication (second insert should
  be ignored by Supabase).

.PARAMETER Url
  Receiver endpoint. Defaults to http://localhost:3000/webhook.

.PARAMETER Bad
  Sign with a wrong secret to verify the receiver rejects with 401.

.EXAMPLE
  # happy path
  .\scripts\send-test-event.ps1

.EXAMPLE
  # simulate a pull_request event
  .\scripts\send-test-event.ps1 -EventType pull_request

.EXAMPLE
  # dedupe check: re-send the same delivery id
  $id = [guid]::NewGuid().Guid
  .\scripts\send-test-event.ps1 -DeliveryId $id
  .\scripts\send-test-event.ps1 -DeliveryId $id

.EXAMPLE
  # signature rejection check
  .\scripts\send-test-event.ps1 -Bad
#>
[CmdletBinding()]
param(
  [string] $EventType  = 'ping',
  [string] $DeliveryId = [guid]::NewGuid().Guid,
  [string] $Url        = 'http://localhost:3000/api/webhook',
  [switch] $Bad
)

$ErrorActionPreference = 'Stop'

# Resolve .env next to the receiver (one level up from scripts/).
$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) {
  throw ".env not found at $envPath. Copy .env.example to .env and fill in values first."
}

$secret = $null
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*GITHUB_WEBHOOK_SECRET\s*=\s*(.+?)\s*$') {
    $secret = $Matches[1].Trim('"').Trim("'")
    break
  }
}
if (-not $secret) {
  throw "GITHUB_WEBHOOK_SECRET not found in $envPath."
}

# Minimal but plausible payload. The receiver stores it verbatim, so the
# exact shape does not matter for the smoke test.
$payload = [ordered]@{
  zen        = 'Speak like a human.'
  hook_id    = 0
  repository = [ordered]@{ full_name = 'sandbox/test'; id = 1 }
  sender     = [ordered]@{ login = 'local-tester'; id = 1 }
  action     = 'test'
}
$body = $payload | ConvertTo-Json -Depth 8 -Compress
$bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)

$signingKey = if ($Bad) { 'this-is-not-the-real-secret' } else { $secret }
$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($signingKey))
try {
  $sigBytes = $hmac.ComputeHash($bodyBytes)
} finally {
  $hmac.Dispose()
}
$signature = 'sha256=' + ([System.BitConverter]::ToString($sigBytes).Replace('-', '').ToLowerInvariant())

$headers = @{
  'X-GitHub-Event'      = $EventType
  'X-GitHub-Delivery'   = $DeliveryId
  'X-GitHub-Hook-ID'    = '0'
  'X-Hub-Signature-256' = $signature
  'User-Agent'          = 'GitHub-Hookshot/local-test'
}

Write-Host "POST $Url" -ForegroundColor Cyan
Write-Host "  event:    $EventType"
Write-Host "  delivery: $DeliveryId"
Write-Host "  signed with: $(if ($Bad) { 'WRONG secret (expecting 401)' } else { '.env secret' })"
Write-Host ''

try {
  $response = Invoke-WebRequest `
    -Uri $Url `
    -Method Post `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body $bodyBytes `
    -UseBasicParsing
} catch [System.Net.WebException] {
  # Windows PowerShell 5.1 throws on non-2xx responses; surface the response anyway.
  $response = $_.Exception.Response
  if ($null -ne $response) {
    $statusCode = [int]$response.StatusCode
    $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
    try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    Write-Host "HTTP $statusCode" -ForegroundColor Yellow
    if ($content) { Write-Host $content }
    exit 0
  }
  Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} catch {
  Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$color = if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { 'Green' } else { 'Yellow' }
Write-Host "HTTP $($response.StatusCode)" -ForegroundColor $color
if ($response.Content) { Write-Host $response.Content }
