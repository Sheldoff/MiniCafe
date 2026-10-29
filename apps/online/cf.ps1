param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WranglerArgs)
$ErrorActionPreference='Stop'
$previousConfig=$env:XDG_CONFIG_HOME
$previousMetrics=$env:WRANGLER_SEND_METRICS
try {
  $env:XDG_CONFIG_HOME=Join-Path $PSScriptRoot '.wrangler-auth'
  $env:WRANGLER_SEND_METRICS='false'
  & node (Join-Path $PSScriptRoot 'node_modules/wrangler/bin/wrangler.js') --cwd $PSScriptRoot @WranglerArgs
  if($LASTEXITCODE -ne 0){throw "Wrangler failed: $LASTEXITCODE"}
} finally {
  $env:XDG_CONFIG_HOME=$previousConfig
  $env:WRANGLER_SEND_METRICS=$previousMetrics
}
