param([string]$PythonExe=$env:MINICAFE_PYTHON,[switch]$SkipExe,[string]$JdkHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
$work=Split-Path $PSScriptRoot -Parent
$jdk=$JdkHome
if(!$jdk){$jdk=(Get-ChildItem "$work/android-tools/jdk" -Directory | Sort-Object Name | Select-Object -Last 1).FullName}
if(!$PythonExe){$PythonExe=(Get-Command python).Source}
function Check {if($LASTEXITCODE -ne 0){throw "Desktop build failed: $LASTEXITCODE"}}
$out=Join-Path "$work/desktop/build" ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force "$out/classes","$out/dist/assets" | Out-Null
$dist="$out/dist"
& $PythonExe -X utf8 "$work/android/prepare_assets.py" "$dist/assets"
Check
$core=@('CafeStore','ImageStore','CafeStats','CafeHttpServer','Codec','CafeLink','PdfFont','PdfReport','AccessControl') | ForEach-Object {"$work/android/src/ua/minicafe/mobile/$_.java"}
& "$jdk/bin/javac.exe" -encoding UTF-8 --release 8 -cp "$work/android/test-libs/android-json.jar;$work/android/libs/nanohttpd.jar" -d "$out/classes" @core "$work/desktop/DesktopServer.java"
Check
& "$jdk/bin/jar.exe" cf "$dist/minicafe-engine.jar" -C "$out/classes" .
Check
Copy-Item -LiteralPath "$work/android/test-libs/android-json.jar","$work/android/libs/nanohttpd.jar" -Destination $dist
& $PythonExe -X utf8 "$work/cafe/frontend_build.py" "$dist/assets/index.html"
Check
Copy-Item -LiteralPath "$work/android/assets/default-menu.json","$work/android/assets/pdf-font.bin","$work/android/assets/fonts/LICENSE-DejaVu.txt" -Destination "$dist/assets"
$runtime="$work/desktop/runtime-cache"
if(!(Test-Path "$runtime/bin/java.exe")){& "$jdk/bin/jlink.exe" --add-modules java.base,java.logging,jdk.crypto.ec --strip-debug --no-header-files --no-man-pages --compress=2 --output $runtime;Check}
Copy-Item -LiteralPath $runtime -Destination "$dist/runtime" -Recurse
# Consumers read a small pointer; no stale class directory is reused.
Set-Content "$work/desktop/current-dist.txt" $dist -Encoding UTF8
if(!$SkipExe){
 # Some bundled Python runtimes load an extra certificate policy from ssl.py.
 # Preserve that data in the executable without changing its TLS policy.
 $extraRuntimeData=@()
 [string]$runtimePolicy=& $PythonExe -c "from pathlib import Path; import ssl; p=Path(ssl.__file__).with_name('codex-rejected-cas.pem'); print(p if p.is_file() else '')"
 Check
 $runtimePolicy=$runtimePolicy.Trim()
 if($runtimePolicy){$extraRuntimeData=@('--add-data',"$runtimePolicy;.")}
 & $PythonExe -X utf8 -m PyInstaller --noconfirm --clean --onefile --windowed --exclude-module numpy --name MiniCafe --distpath "$(Split-Path $work -Parent)/outputs" --workpath "$out/pyinstaller" --specpath $out --paths "$work/cafe" --add-data "$dist;desktop/dist" @extraRuntimeData "$work/cafe/app.py"
 Check
}
Write-Output "Desktop engine: $dist"
