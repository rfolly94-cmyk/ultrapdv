#Requires -Version 5.1
$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host $msg }
function Write-Fail($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red }

$raiz = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $raiz
$installerDir = $PSScriptRoot
$staging = Join-Path $installerDir "staging"
$generated = Join-Path $installerDir "generated"
$dist = Join-Path $raiz "dist"
$versionFile = Join-Path $raiz "version.json"

if (-not (Test-Path $versionFile)) {
  Write-Fail "version.json nao encontrado em $versionFile"
  exit 1
}

$versao = Get-Content -Raw $versionFile | ConvertFrom-Json
$productVersion = [string]$versao.version
$productName = [string]$versao.name
$setupName = [string]$versao.setupName
if (-not $productVersion -or -not $setupName) {
  Write-Fail "version.json incompleto (version/setupName)."
  exit 1
}

Write-Info "UltraPDV Connector $productVersion"
Write-Info "Validando arquivos..."

$obrigatorios = @(
  (Join-Path $raiz "src\server.mjs"),
  (Join-Path $raiz "src\motor.mjs"),
  (Join-Path $raiz "src\imprimir.mjs"),
  (Join-Path $raiz "src\identidade.mjs"),
  (Join-Path $raiz "src\instancia.mjs"),
  (Join-Path $raiz "src\origens.mjs"),
  (Join-Path $raiz "src\raiz.mjs"),
  (Join-Path $raiz "src\versao.mjs"),
  (Join-Path $raiz "src\stop.mjs"),
  (Join-Path $raiz "src\verify.mjs"),
  (Join-Path $raiz "src\portas.mjs"),
  (Join-Path $raiz "src\config-local.mjs"),
  (Join-Path $raiz "src\log.mjs"),
  (Join-Path $raiz "src\pdf-teste.mjs"),
  (Join-Path $raiz "src\mutex.mjs"),
  (Join-Path $raiz "src\tray.mjs"),
  (Join-Path $raiz "src\pagina-status.html"),
  (Join-Path $raiz "launcher\start.vbs"),
  (Join-Path $raiz "launcher\tray.ps1"),
  (Join-Path $raiz "config\origins.json"),
  (Join-Path $raiz "THIRD-PARTY-NOTICES.txt"),
  (Join-Path $raiz "licenses\AGPL-3.0.txt"),
  (Join-Path $raiz "licenses\SumatraPDF-LICENSE.txt"),
  (Join-Path $raiz "licenses\NODE-LICENSE.txt"),
  (Join-Path $raiz "licenses\UltraPDV-Connector-EULA.txt"),
  (Join-Path $installerDir "ultrapdv-connector.nsi"),
  (Join-Path $installerDir "validar-sumatra.ps1")
)

$faltando = @()
foreach ($arquivo in $obrigatorios) {
  if (-not (Test-Path $arquivo)) { $faltando += $arquivo }
}
if ($faltando.Count -gt 0) {
  Write-Fail "Arquivos obrigatorios ausentes:"
  $faltando | ForEach-Object { Write-Host "  $_" }
  exit 1
}

$nodeExe = Join-Path $raiz "runtime\node.exe"
if (-not (Test-Path $nodeExe)) {
  Write-Fail "Runtime Node nao encontrado."
  Write-Host ""
  Write-Host "Baixe o zip win-x64 em https://nodejs.org/dist/ (recomendado v22 LTS)."
  Write-Host "Extraia e copie:"
  Write-Host "  node.exe  -> print-agent\runtime\node.exe"
  Write-Host "  LICENSE   -> print-agent\runtime\LICENSE"
  Write-Host ""
  Write-Host "Nao adicione este Node ao PATH. O instalador usa runtime privado."
  exit 1
}

$nodeVer = & $nodeExe -v
if ($LASTEXITCODE -ne 0) {
  Write-Fail "node.exe do runtime nao executou."
  exit 1
}
Write-Info "Runtime Node: $nodeVer"

. (Join-Path $installerDir "validar-sumatra.ps1")

Write-Info "Preparando motor SumatraPDF..."
$pastaMotor = Prepare-SumatraMotor $raiz
Assert-SumatraMotor $pastaMotor
$sumatra = Join-Path $pastaMotor "SumatraPDF.exe"
$sumatraDll = Join-Path $pastaMotor "libmupdf.dll"
$sumatraInfo = Get-Item $sumatra
Write-Info ("SumatraPDF: {0} ({1:N0} bytes + libmupdf.dll)" -f $sumatraInfo.VersionInfo.ProductVersion, $sumatraInfo.Length)

$makensis = @(
  "${env:ProgramFiles}\NSIS\makensis.exe",
  "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $makensis) {
  $cmd = Get-Command makensis -ErrorAction SilentlyContinue
  if ($cmd) { $makensis = $cmd.Source }
}

if (-not $makensis) {
  Write-Fail "makensis.exe nao encontrado."
  Write-Host ""
  Write-Host "Instale o NSIS 3:"
  Write-Host "  https://nsis.sourceforge.io/Download"
  Write-Host "Depois rode novamente:"
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File print-agent\installer\build.ps1"
  Write-Host ""
  Write-Host "Este script nao baixa o NSIS automaticamente."
  exit 1
}
Write-Info "NSIS: $makensis"

function ConvertTo-NsisPath([string]$caminho) {
  return ($caminho -replace '\\', '\\')
}

function Get-JsonVersion([string]$arquivo) {
  $bruto = Get-Content -Raw -Path $arquivo
  $obj = $bruto | ConvertFrom-Json
  return [string]$obj.version
}

function Assert-MesmoArquivo([string]$origem, [string]$copia, [string]$rotulo) {
  if (-not (Test-Path $origem)) {
    Write-Fail "$rotulo origem ausente: $origem"
    exit 1
  }
  if (-not (Test-Path $copia)) {
    Write-Fail "$rotulo staging ausente: $copia"
    exit 1
  }
  $h1 = (Get-FileHash -Algorithm SHA256 $origem).Hash
  $h2 = (Get-FileHash -Algorithm SHA256 $copia).Hash
  if ($h1 -ne $h2) {
    Write-Fail "$rotulo no staging nao e o arquivo atual do print-agent."
    Write-Host "  origem:  $origem"
    Write-Host "  staging: $copia"
    exit 1
  }
}

$pkgFile = Join-Path $raiz "package.json"
$pkgRaw = Get-Content -Raw $pkgFile
$pkgAtualizado = [regex]::Replace($pkgRaw, '"version"\s*:\s*"[^"]+"', '"version": "' + $productVersion + '"', 1)
if ($pkgAtualizado -ne $pkgRaw) {
  Set-Content -Path $pkgFile -Value $pkgAtualizado -NoNewline -Encoding utf8
  Write-Info "package.json sincronizado para $productVersion"
}

New-Item -ItemType Directory -Force -Path $generated, $dist | Out-Null
$setupOut = Join-Path $dist "$setupName.exe"

Write-Info "Limpando Setup antigos em dist..."
Get-ChildItem -Path $dist -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "*Setup*.exe" -or $_.Name -like "UltraPDV-Conector*" } |
  ForEach-Object {
    Write-Info ("  removendo {0}" -f $_.Name)
    Remove-Item -LiteralPath $_.FullName -Force
  }

Write-Info "Limpando staging/cache anterior..."
if (Test-Path $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}

$setupOutNsis = ConvertTo-NsisPath $setupOut
$stagingNsis = ConvertTo-NsisPath $staging
$nsh = @"
!define PRODUCT_NAME "$productName"
!define PRODUCT_VERSION "$productVersion"
!define PRODUCT_PUBLISHER "UltraPDV"
!define SETUP_NAME "$setupName"
!define SETUP_OUTFILE "$setupOutNsis"
!define STAGING_DIR "$stagingNsis"
"@
Set-Content -Path (Join-Path $generated "version.nsh") -Value $nsh -Encoding ASCII

New-Item -ItemType Directory -Force -Path @(
  (Join-Path $staging "runtime"),
  (Join-Path $staging "app"),
  (Join-Path $staging "print-engine"),
  (Join-Path $staging "licenses"),
  (Join-Path $staging "launcher"),
  (Join-Path $staging "config")
) | Out-Null

Copy-Item $nodeExe (Join-Path $staging "runtime\node.exe")
$nodeLicense = Join-Path $raiz "runtime\LICENSE"
if (Test-Path $nodeLicense) {
  Copy-Item $nodeLicense (Join-Path $staging "runtime\LICENSE")
} else {
  Copy-Item (Join-Path $raiz "licenses\NODE-LICENSE.txt") (Join-Path $staging "runtime\LICENSE")
  Write-Host "AVISO: print-agent\runtime\LICENSE ausente; usando licenses\NODE-LICENSE.txt (resumo)." -ForegroundColor Yellow
  Write-Host "Copie o LICENSE completo do zip oficial do Node para o runtime."
}

$appFiles = @(
  "server.mjs", "motor.mjs", "imprimir.mjs", "identidade.mjs", "instancia.mjs",
  "origens.mjs", "raiz.mjs", "versao.mjs", "stop.mjs", "verify.mjs",
  "portas.mjs", "config-local.mjs", "log.mjs", "pdf-teste.mjs", "mutex.mjs",
  "tray.mjs", "pagina-status.html"
)
foreach ($nome in $appFiles) {
  Copy-Item (Join-Path $raiz "src\$nome") (Join-Path $staging "app\$nome")
}
Copy-Item $versionFile (Join-Path $staging "app\version.json")
Copy-Item $versionFile (Join-Path $staging "version.json")
Copy-Item $sumatra (Join-Path $staging "print-engine\SumatraPDF.exe")
Copy-Item $sumatraDll (Join-Path $staging "print-engine\libmupdf.dll")
Copy-Item (Join-Path $raiz "licenses\*") (Join-Path $staging "licenses") -Recurse -Force
Copy-Item (Join-Path $raiz "launcher\start.vbs") (Join-Path $staging "launcher\start.vbs")
Copy-Item (Join-Path $raiz "launcher\tray.ps1") (Join-Path $staging "launcher\tray.ps1")
Copy-Item (Join-Path $raiz "config\origins.json") (Join-Path $staging "config\origins.json")
Copy-Item (Join-Path $raiz "THIRD-PARTY-NOTICES.txt") (Join-Path $staging "THIRD-PARTY-NOTICES.txt")

$proibidos = @(
  (Join-Path $staging ".env"),
  (Join-Path $staging ".env.local"),
  (Join-Path $staging "app\.env")
)
foreach ($p in $proibidos) {
  if (Test-Path $p) {
    Write-Fail "Arquivo secreto nao pode entrar no instalador: $p"
    exit 1
  }
}

$versaoStaging = Get-JsonVersion (Join-Path $staging "version.json")
$versaoApp = Get-JsonVersion (Join-Path $staging "app\version.json")
if ($versaoStaging -ne $productVersion -or $versaoApp -ne $productVersion) {
  Write-Fail "version.json no staging ($versaoStaging / $versaoApp) difere de $productVersion."
  exit 1
}
Assert-MesmoArquivo $versionFile (Join-Path $staging "version.json") "version.json"
Assert-MesmoArquivo $versionFile (Join-Path $staging "app\version.json") "app/version.json"
foreach ($nome in @("server.mjs", "origens.mjs", "imprimir.mjs", "portas.mjs", "versao.mjs")) {
  Assert-MesmoArquivo (Join-Path $raiz "src\$nome") (Join-Path $staging "app\$nome") $nome
}
Write-Info "Staging validado: $productVersion (arquivos atuais do print-agent\src)"

Write-Info "Compilando instalador..."
Push-Location $installerDir
try {
  & $makensis /V2 ".\ultrapdv-connector.nsi"
  $nsisExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($nsisExit -ne 0 -or -not (Test-Path $setupOut)) {
  Write-Fail "Falha ao gerar o Setup.exe"
  exit 1
}

$setupInfo = Get-Item $setupOut
$sha = (Get-FileHash -Algorithm SHA256 $setupOut).Hash
Write-Host ""
Write-Host "OK $productName $productVersion"
Write-Host "Arquivo: $setupOut"
Write-Host ("Tamanho: {0:N1} MB ({1} bytes)" -f ($setupInfo.Length / 1MB), $setupInfo.Length)
Write-Host ("Data: {0:yyyy-MM-dd HH:mm:ss}" -f $setupInfo.LastWriteTime)
Write-Host "SHA256: $sha"
Write-Host "Proximo passo: encerre o agente de desenvolvimento e instale este Setup como cliente."
