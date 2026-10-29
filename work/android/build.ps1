param([string]$PythonExe=$env:MINICAFE_PYTHON,[string]$JdkHome=$env:JAVA_HOME,[string]$SdkHome=$env:ANDROID_HOME)
$ErrorActionPreference='Stop'
$base=Split-Path $PSScriptRoot -Parent
if (!$PythonExe) {$candidate=Get-Command python -ErrorAction SilentlyContinue;if($candidate){$PythonExe=$candidate.Source}else{$PythonExe=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'}}
if (!$JdkHome) {$JdkHome=(Get-ChildItem "$base/android-tools/jdk" -Directory | Sort-Object Name | Select-Object -Last 1).FullName}
if (!$SdkHome) {$SdkHome="$base/android-tools/sdk"}
$tools="$SdkHome/build-tools/35.0.0";$platform="$SdkHome/platforms/android-35/android.jar"
function Check {if($LASTEXITCODE -ne 0){throw "Build failed: $LASTEXITCODE"}}
$java="$JdkHome/bin/java.exe";$javac="$JdkHome/bin/javac.exe"
$version=& $java --version | Out-String
if($version -notmatch 'openjdk 17\.|java 17\.') {throw 'JDK 17 is required'}
& $PythonExe -c 'import sys; assert sys.version_info >= (3,10)'
Check
$key="$PSScriptRoot/minicafe-signing.jks"
if (!(Test-Path -LiteralPath $key)) {throw 'Release signing key is missing. Restore the original key; a new key will never be generated automatically.'}
$secretsPath="$PSScriptRoot/signing.local.json"
$storePassword=$env:MINICAFE_STORE_PASSWORD;$keyPassword=$env:MINICAFE_KEY_PASSWORD
if (!$storePassword -and (Test-Path $secretsPath)) {$secrets=Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json;$storePassword=$secrets.storePassword;$keyPassword=$secrets.keyPassword}
if (!$storePassword) {throw 'Set signing credentials in environment or signing.local.json'}
if (!$keyPassword) {$keyPassword=$storePassword}
$env:MINICAFE_SIGN_STORE=$storePassword;$env:MINICAFE_SIGN_KEY=$keyPassword
$certificate=& "$JdkHome/bin/keytool.exe" -exportcert -keystore $key -alias minicafe -storepass:env MINICAFE_SIGN_STORE -rfc 2>$null
Check
$encoded=($certificate -join '') -replace '-----BEGIN CERTIFICATE-----','' -replace '-----END CERTIFICATE-----','' -replace '\s',''
$hash=[System.Security.Cryptography.SHA256]::Create();$fingerprint=([BitConverter]::ToString($hash.ComputeHash([Convert]::FromBase64String($encoded)))).Replace('-','').ToLowerInvariant()
if($fingerprint -ne (Get-Content "$PSScriptRoot/signing-cert.sha256" -Raw).Trim()){throw 'Signing certificate does not match released MiniCafe APKs'}
$dependencies=Get-Content "$PSScriptRoot/dependencies.sha256.json" -Raw | ConvertFrom-Json
foreach($property in $dependencies.PSObject.Properties){if(([BitConverter]::ToString($hash.ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $property.Name))))).Replace('-','').ToLowerInvariant() -ne $property.Value){throw "Dependency checksum mismatch: $($property.Name)"}}
# A fresh directory excludes stale classes/resources without deleting any existing checkout files.
$out=Join-Path "$PSScriptRoot/build" ('release-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force "$out/classes","$out/dex","$out/generated","$out/packaged-assets" | Out-Null
$zxing="$PSScriptRoot/libs/zxing-core.jar";$nano="$PSScriptRoot/libs/nanohttpd.jar"
& $PythonExe -X utf8 "$PSScriptRoot/prepare_assets.py" "$out/packaged-assets"
Check
& "$tools/aapt2.exe" compile --dir "$PSScriptRoot/res" -o "$out/resources.zip"
Check
& "$tools/aapt2.exe" link -0 bin -o "$out/unsigned.apk" -I $platform --manifest "$PSScriptRoot/AndroidManifest.xml" -A "$out/packaged-assets" --java "$out/generated" "$out/resources.zip"
Check
$sources=@(Get-ChildItem "$PSScriptRoot/src" -Recurse -Filter *.java | Select-Object -ExpandProperty FullName)+@(Get-ChildItem "$out/generated" -Recurse -Filter *.java | Select-Object -ExpandProperty FullName)
& $javac -encoding UTF-8 --release 8 -classpath "$platform;$zxing;$nano" -d "$out/classes" @sources
Check
& "$JdkHome/bin/jar.exe" cf "$out/classes.jar" -C "$out/classes" .
Check
& $java -cp "$tools/lib/d8.jar" com.android.tools.r8.D8 --lib $platform --min-api 23 --output "$out/dex" "$out/classes.jar" $zxing $nano
Check
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::Open("$out/unsigned.apk",'Update');[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,"$out/dex/classes.dex",'classes.dex') | Out-Null;$archive.Dispose()
& "$tools/zipalign.exe" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
Check
$destination=Join-Path (Split-Path $base -Parent) 'outputs/MiniCafe.apk'
New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
try {& $java -jar "$tools/lib/apksigner.jar" sign --ks $key --ks-key-alias minicafe --ks-pass env:MINICAFE_SIGN_STORE --key-pass env:MINICAFE_SIGN_KEY --out $destination "$out/aligned.apk";Check}finally{$env:MINICAFE_SIGN_STORE=$null;$env:MINICAFE_SIGN_KEY=$null}
& $java -jar "$tools/lib/apksigner.jar" verify --verbose --print-certs $destination
Check
& $PythonExe -X utf8 "$PSScriptRoot/verify_apk.py" $destination
Check
Write-Output "Built APK in clean directory: $out"

