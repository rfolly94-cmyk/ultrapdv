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

if ($productVersion -notmatch '^\d+\.\d+\.\d+$') {
  Write-Fail "A versao do Connector precisa ser numerica."
  exit 1
}
$nomeAgente = [string]$versao.agenteTef
if ($nomeAgente -ne "UltraPDVTef_1313.exe") {
  Write-Fail "Esta atualizacao deve distribuir UltraPDVTef_1313.exe e manter UltraPDVTef_139.exe intacto."
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
!define TEF_EXE_NAME "$nomeAgente"
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
$tefExe = Join-Path $raiz "bin\tef\$nomeAgente"
if (-not (Test-Path -LiteralPath $tefExe -PathType Leaf)) {
  throw "Executavel TEF nao encontrado: $tefExe"
}
$hashAgente1313 = "F1E32D1B339B07378B828A0076B088B83F18B1945E996D7B539090D8D4C4EA61"
$hashAgente = (Get-FileHash -Algorithm SHA256 -LiteralPath $tefExe).Hash
if ($hashAgente -ne $hashAgente1313) {
  Write-Fail "O agente TEF nao e o binario conferido."
  Write-Host "  esperado: $hashAgente1313"
  Write-Host "  obtido:   $hashAgente"
  exit 1
}
$hash139Esperado = "EE9909238404931649F98A7437C499D257BB3080E1D23F89DEA5A2CF60814904"
$agente139 = Join-Path $raiz "bin\tef\UltraPDVTef_139.exe"
if (-not (Test-Path -LiteralPath $agente139)) {
  Write-Fail "UltraPDVTef_139.exe precisa permanecer no diretorio para rollback."
  exit 1
}
$hash139 = (Get-FileHash -Algorithm SHA256 -LiteralPath $agente139).Hash
if ($hash139 -ne $hash139Esperado) {
  Write-Fail "UltraPDVTef_139.exe foi alterado. A compilacao 1.3.9 precisa permanecer intacta."
  Write-Host "  esperado: $hash139Esperado"
  Write-Host "  obtido:   $hash139"
  exit 1
}
$agenteAnterior = Join-Path $raiz "bin\tef\UltraPDVTef_138.exe"
if (Test-Path -LiteralPath $agenteAnterior) {
  $hashAnteriorEsperado = "C51E326DC6B0FD4D6D91810C46F0132147D450E531C93B02366A14C2F6D12C56"
  $hashAnterior = (Get-FileHash -Algorithm SHA256 -LiteralPath $agenteAnterior).Hash
  if ($hashAnterior -ne $hashAnteriorEsperado) {
    Write-Fail "UltraPDVTef_138.exe foi alterado. A compilacao anterior precisa permanecer intacta."
    Write-Host "  esperado: $hashAnteriorEsperado"
    Write-Host "  obtido:   $hashAnterior"
    exit 1
  }
}
Write-Info "Agente TEF conferido: $hashAgente"
Copy-Item -LiteralPath $tefExe -Destination (Join-Path $staging "bin\tef\$nomeAgente") -ErrorAction Stop
$hashDepoisDaCopia = (Get-FileHash -Algorithm SHA256 -LiteralPath $tefExe).Hash
if ($hashDepoisDaCopia -ne $hashAgente1313) {
  Write-Fail "A copia para o instalador alterou UltraPDVTef_1313.exe."
  exit 1
}
$agenteTexto = [System.Text.Encoding]::GetEncoding(28591).GetString([System.IO.File]::ReadAllBytes($tefExe))
foreach ($marca in @("117473", "pos-transac-sb.tpgweb.io", "42.741.754/0001-42", "6696546", "pos-transac.pgweb.io")) {
  if ($agenteTexto.Contains($marca)) {
    Write-Fail "O agente TEF contem ponto, servidor ou documento fixo: $marca"
    exit 1
  }
}
if (-not $agenteTexto.Contains("bibliotecaInstalada") -or -not $agenteTexto.Contains("pontoSolicitado") -or -not $agenteTexto.Contains("diretorioBiblioteca")) {
  Write-Fail "O agente TEF nao informa a pasta nem a observacao da biblioteca."
  exit 1
}
foreach ($marcaAgente in @("tipoCartao", "PWINFO_CARDTYPE", "UltraPDV\TEF\Producao", "PROGRAMDATA")) {
  if (-not $agenteTexto.Contains($marcaAgente)) {
    Write-Fail "O agente TEF nao declara a producao em ProgramData nem o tipo do cartao: $marcaAgente"
    exit 1
  }
}
$extrasTef = Get-ChildItem -LiteralPath (Join-Path $staging "bin\tef") -Recurse -Force |
  Where-Object { $_.Name -ne $nomeAgente }
if ($extrasTef) {
  Write-Fail "O pacote TEF so pode levar $nomeAgente. O executavel antigo e os dados do PayGo ficam na maquina."
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
if ([string]$pacoteObj.executavel -ne ("bin/tef/" + $nomeAgente)) {
  Write-Fail "tef-pacote.json aponta para $($pacoteObj.executavel), mas a versao $productVersion exige bin/tef/$nomeAgente."
  exit 1
}
if (-not $agenteTexto.Contains("1.3.13") -or -not $agenteTexto.Contains("PortaPinPad") -or -not $agenteTexto.Contains("LIMITE_REPETICOES_PPCOMM")) {
  Write-Fail "O agente TEF nao e a compilacao 1.3.13 com o diagnostico de pinpad."
  exit 1
}
if ($agenteTexto.Contains("COM7")) {
  Write-Fail "O agente TEF nao pode forcar a COM7."
  exit 1
}
foreach ($marcaNova in @("diretorioPai", "diretorioPwInit", "retornoPwInit", "retornoPwInitNome")) {
  if (-not $agenteTexto.Contains($marcaNova)) {
    Write-Fail "O agente TEF nao informa o diretorio enviado a PW_iInit: $marcaNova"
    exit 1
  }
}
Copy-Item $pacoteTef (Join-Path $staging "tef-pacote.json")
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
