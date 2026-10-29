param(
  [string]$PythonExe='python',
  [string]$JdkHome=$env:JAVA_HOME,
  [string]$SdkHome=$env:ANDROID_HOME
)
$ErrorActionPreference='Stop'
$work=Split-Path $PSScriptRoot -Parent
if(!$JdkHome -and (Test-Path "$work/android-tools/jdk")) {
  $JdkHome=(Get-ChildItem "$work/android-tools/jdk" -Directory | Sort-Object Name | Select-Object -Last 1).FullName
}
if(!$SdkHome){$SdkHome="$work/android-tools/sdk"}
if(!(Test-Path "$JdkHome/bin/javac.exe")){throw 'Install JDK 17 and pass -JdkHome or JAVA_HOME.'}
if(!(Test-Path "$SdkHome/platforms/android-35/android.jar") -or !(Test-Path "$SdkHome/build-tools/35.0.0/aapt2.exe")) {
  throw 'Install Android SDK platforms;android-35 and build-tools;35.0.0; pass -SdkHome or ANDROID_HOME.'
}
function CheckExit {if($LASTEXITCODE -ne 0){throw "Setup command failed: $LASTEXITCODE"}}
& $PythonExe -c 'import sys; assert sys.version_info >= (3,10)'; CheckExit
& "$JdkHome/bin/java.exe" --version; CheckExit
& node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; CheckExit
$env:MINICAFE_PYTHON=(Get-Command $PythonExe).Source
$env:JAVA_HOME=$JdkHome
$env:ANDROID_HOME=$SdkHome
# Android checks and the frontend builder use Python's standard library.
# Frozen desktop dependencies (PyInstaller, Tk, etc.) are not installed here.
Push-Location "$work/tooling"
try {
  & npm ci; CheckExit
  & node node_modules/playwright/cli.js install chromium webkit; CheckExit
  $env:PLAYWRIGHT_MODULE=(Resolve-Path node_modules/playwright).Path
  [string]$chromium=& node -e 'console.log(require("playwright").chromium.executablePath())'; CheckExit
  $env:CHROME_EXECUTABLE=$chromium.Trim()
} finally { Pop-Location }
Write-Output 'Development dependencies ready. Run python -X utf8 work/scripts/checks.py from the project root.'
Write-Output 'APK signing requires your separately saved original keystore and passwords. See START-HERE-UA.md.'
