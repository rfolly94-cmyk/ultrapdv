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
  (Join-Path $raiz "src\gaveta.mjs"),
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
  (Join-Path $raiz "launcher\supervisor.ps1"),
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

if (Test-Path -LiteralPath $setupOut) {
  $infoAnterior = Get-Item -LiteralPath $setupOut
  $versaoAnterior = [string]$infoAnterior.VersionInfo.ProductVersion
  if ($versaoAnterior -match '^(\d+\.\d+\.\d+)') {
    $versaoAnterior = $Matches[1]
  } else {
    $versaoAnterior = $infoAnterior.LastWriteTime.ToString("yyyyMMdd-HHmmss")
  }
  $rollback = Join-Path $dist "$setupName-$versaoAnterior.exe"
  if ($versaoAnterior -eq $productVersion -or (Test-Path -LiteralPath $rollback)) {
    $rollback = Join-Path $dist "$setupName-$versaoAnterior-$($infoAnterior.LastWriteTime.ToString('yyyyMMdd-HHmmss')).exe"
  }
  Write-Info "Preservando Setup anterior para rollback: $rollback"
  Copy-Item -LiteralPath $setupOut -Destination $rollback -Force
  if (-not (Test-Path -LiteralPath $rollback)) {
    Write-Fail "Nao foi possivel preservar o Setup anterior."
    exit 1
  }
}

Write-Info "Limpando staging/cache anterior..."
if (Test-Path $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}

if ($productVersion -notmatch '^\d+\.\d+\.\d+$') {
  Write-Fail "A versao do Connector precisa ser numerica."
  exit 1
}
if ([string]$versao.agenteTef) {
  Write-Fail "O pacote nao distribui mais o agente Pascal."
  exit 1
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
  (Join-Path $staging "bin\tef"),
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

Write-Info "Resolvendo modulos do Connector..."
$listaApp = & $nodeExe (Join-Path $installerDir "empacotar-app.mjs") --list (Join-Path $raiz "src")
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Nao foi possivel resolver os imports de src."
  exit 1
}
$appFiles = @($listaApp | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
if ($appFiles -notcontains "tef-prova.mjs" -or $appFiles -notcontains "tef-recuperacao.mjs") {
  Write-Fail "O grafo de empacotamento nao inclui os modulos TEF obrigatorios."
  exit 1
}
foreach ($nome in $appFiles) {
  Copy-Item (Join-Path $raiz "src\$nome") (Join-Path $staging "app\$nome")
}
$exesLegados = @(Get-ChildItem -LiteralPath (Join-Path $raiz "bin\tef") -Filter "UltraPDVTef*.exe" -File -ErrorAction SilentlyContinue)
if ($exesLegados.Count -gt 0) {
  Write-Fail "O diretorio bin\tef ainda contem executavel do agente Pascal."
  exit 1
}
$dllOrigem = Join-Path $raiz "bin\tef\PGWebLib.dll"
$hashDllEsperado = "D17AC81323396AE172648935B0B797B74705B1CA01C9AE0CD3B2FF78119D4220"
if (-not (Test-Path -LiteralPath $dllOrigem)) {
  Write-Fail "PGWebLib.dll x64 4.1.50.924 ausente em bin\tef."
  exit 1
}
$hashDll = (Get-FileHash -Algorithm SHA256 -LiteralPath $dllOrigem).Hash
if ($hashDll -ne $hashDllEsperado) {
  Write-Fail "A integridade da PGWebLib.dll nao confere com o kit 4.1.50.924."
  Write-Host "  esperado: $hashDllEsperado"
  Write-Host "  obtido:   $hashDll"
  exit 1
}
$assinaturaDll = Get-AuthenticodeSignature -LiteralPath $dllOrigem
$assuntoDll = [string]$assinaturaDll.SignerCertificate.Subject
if ($assinaturaDll.Status -ne "Valid" -or $assuntoDll -notmatch "SETIS Automacao e Sistemas Ltda") {
  Write-Fail "A assinatura da PGWebLib.dll nao foi confirmada como SETIS."
  exit 1
}
Copy-Item -LiteralPath $dllOrigem -Destination (Join-Path $staging "bin\tef\PGWebLib.dll") -ErrorAction Stop
$extrasTef = Get-ChildItem -LiteralPath (Join-Path $staging "bin\tef") -Recurse -Force |
  Where-Object { $_.Name -ne "PGWebLib.dll" }
if ($extrasTef) {
  Write-Fail "O pacote TEF so pode levar a PGWebLib.dll. Journals, certificados e o executavel antigo ficam na maquina."
  $extrasTef | ForEach-Object { Write-Host "  $($_.FullName)" }
  exit 1
}
Copy-Item $versionFile (Join-Path $staging "app\version.json")
Copy-Item $versionFile (Join-Path $staging "version.json")
$pacoteTef = Join-Path $raiz "tef-pacote.json"
if (-not (Test-Path -LiteralPath $pacoteTef)) {
  Write-Fail "tef-pacote.json nao encontrado."
  exit 1
}
$pacoteObj = Get-Content -Raw $pacoteTef | ConvertFrom-Json
if ([string]$pacoteObj.executavel) {
  Write-Fail "tef-pacote.json ainda aponta para um executavel Pascal."
  exit 1
}
if ([string]$pacoteObj.dll -ne "bin/tef/PGWebLib.dll") {
  Write-Fail "tef-pacote.json nao aponta para a PGWebLib.dll x64."
  exit 1
}
Copy-Item $pacoteTef (Join-Path $staging "tef-pacote.json")
Copy-Item $sumatra (Join-Path $staging "print-engine\SumatraPDF.exe")
Copy-Item $sumatraDll (Join-Path $staging "print-engine\libmupdf.dll")
Copy-Item (Join-Path $raiz "licenses\*") (Join-Path $staging "licenses") -Recurse -Force
Copy-Item (Join-Path $raiz "launcher\start.vbs") (Join-Path $staging "launcher\start.vbs")
Copy-Item (Join-Path $raiz "launcher\supervisor.ps1") (Join-Path $staging "launcher\supervisor.ps1")
Copy-Item (Join-Path $raiz "launcher\tray.ps1") (Join-Path $staging "launcher\tray.ps1")
$koffiOrigem = Join-Path $raiz "node_modules\koffi"
$koffiNativo = Join-Path $raiz "node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node"
if (-not (Test-Path -LiteralPath $koffiNativo)) {
  Write-Fail "O carregador nativo koffi win32-x64 nao esta em node_modules. A PGWebLib nao seria carregada pelo Connector."
  exit 1
}
$koffiDestino = Join-Path $staging "app\node_modules\koffi"
New-Item -ItemType Directory -Force -Path $koffiDestino | Out-Null
foreach ($parte in @("package.json", "LICENSE.txt", "index.js", "index.cjs", "indirect.js", "indirect.cjs", "src", "lib")) {
  $item = Join-Path $koffiOrigem $parte
  if (Test-Path -LiteralPath $item) {
    Copy-Item -LiteralPath $item -Destination (Join-Path $koffiDestino $parte) -Recurse -Force
  }
}
$koromix = Join-Path $staging "app\node_modules\@koromix"
New-Item -ItemType Directory -Force -Path $koromix | Out-Null
Copy-Item -Path (Join-Path $raiz "node_modules\@koromix\koffi-win32-x64") -Destination $koromix -Recurse -Force
$nativoDestino = Join-Path $koromix "koffi-win32-x64\win32_x64\koffi.node"
if (-not (Test-Path -LiteralPath $nativoDestino)) {
  Write-Fail "A copia do koffi win32-x64 nao chegou ao staging."
  exit 1
}
$licencaKoffi = Get-Content -Raw (Join-Path $koffiDestino "LICENSE.txt")
if ($licencaKoffi -notmatch "MIT") {
  Write-Fail "A licenca do koffi nao e a MIT esperada."
  exit 1
}
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
Assert-MesmoArquivo $pacoteTef (Join-Path $staging "tef-pacote.json") "tef-pacote.json"
Assert-MesmoArquivo $versionFile (Join-Path $staging "app\version.json") "app/version.json"
foreach ($nome in $appFiles) {
  Assert-MesmoArquivo (Join-Path $raiz "src\$nome") (Join-Path $staging "app\$nome") $nome
}
$servidorEmpacotado = Get-Content -Raw (Join-Path $staging "app\server.mjs")
if ($servidorEmpacotado -notmatch 'CABECALHOS_CORS_PERMITIDOS[\s\S]{0,400}x-ultrapdv-dispositivo') {
  Write-Fail "O server.mjs empacotado nao autoriza x-ultrapdv-dispositivo."
  exit 1
}
if ($servidorEmpacotado -match 'Access-Control-Allow-Origin"\s*=\s*"\*"') {
  Write-Fail "O server.mjs empacotado libera qualquer origem."
  exit 1
}
$tefEmpacotado = Get-Content -Raw (Join-Path $staging "app\tef.mjs")
if ($tefEmpacotado -notmatch "validarPastaConfirmada" -or $tefEmpacotado -notmatch "mensagemRetornoBiblioteca") {
  Write-Fail "O Connector empacotado nao valida a pasta confirmada nem preserva o codigo do PW_iInit."
  exit 1
}
$pastaEmpacotada = Get-Content -Raw (Join-Path $staging "app\tef-pasta.mjs")
$inicioValidacao = $pastaEmpacotada.IndexOf("export async function validarPastaConfirmada")
$fimValidacao = $pastaEmpacotada.IndexOf("export async function testarGravacaoOperacional")
if ($inicioValidacao -lt 0 -or $fimValidacao -le $inicioValidacao) {
  Write-Fail "A validacao da pasta confirmada nao foi empacotada."
  exit 1
}
$validacaoEmpacotada = $pastaEmpacotada.Substring($inicioValidacao, $fimValidacao - $inicioValidacao)
if ($validacaoEmpacotada.Contains("testarGravacaoPasta") -or $validacaoEmpacotada.Contains("icacls")) {
  Write-Fail "A validacao da pasta confirmada ainda cria arquivo temporario ou executa icacls."
  exit 1
}
$prepararEmpacotado = Get-Content -Raw (Join-Path $staging "app\tef-preparar-pasta.mjs")
if ($prepararEmpacotado.Contains("UltraPDV-TEF") -or $prepararEmpacotado.Contains("validarPastaConfirmada")) {
  Write-Fail "A preparacao do instalador nao pode redefinir a pasta personalizada."
  exit 1
}
& $nodeExe (Join-Path $installerDir "empacotar-app.mjs") --verificar (Join-Path $staging "app")
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Imports do diretorio empacotado nao resolveram."
  exit 1
}
& $nodeExe (Join-Path $installerDir "empacotar-app.mjs") --auditar-nsi (Join-Path $installerDir "ultrapdv-connector.nsi")
if ($LASTEXITCODE -ne 0) {
  Write-Fail "O instalador NSIS apagaria configuracao ou pendencia financeira."
  exit 1
}
Write-Info "Staging validado: $productVersion ($($appFiles.Count) arquivos de app, imports resolvidos)"

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
Write-Host "Pacote local pronto. Nao execute o Setup nesta etapa."
