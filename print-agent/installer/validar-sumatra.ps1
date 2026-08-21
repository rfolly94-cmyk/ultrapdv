# Validacao do motor SumatraPDF empacotado pelo UltraPDV Conector.
# O exe 3.6.x de instalacao e identico ao SumatraPDF.exe instalado;
# sem libmupdf.dll ao lado ele abre o instalador em vez de imprimir.

$script:MensagemMotorInstalador =
  "o arquivo informado como motor SumatraPDF parece ser um instalador e nao pode ser empacotado."

function Test-SumatraEhInstaladorPorNome([string]$caminho) {
  $nome = [IO.Path]::GetFileName([string]$caminho).ToLowerInvariant()
  return ($nome -match "install" -or $nome -match "setup")
}

function Test-SumatraPastaMotor([string]$pasta) {
  $exe = Join-Path $pasta "SumatraPDF.exe"
  $dll = Join-Path $pasta "libmupdf.dll"
  if (-not (Test-Path $exe)) {
    return @{ Ok = $false; Erro = "SumatraPDF.exe nao encontrado em $pasta" }
  }
  if ([IO.Path]::GetExtension($exe).ToLowerInvariant() -ne ".exe") {
    return @{ Ok = $false; Erro = "O motor precisa ser um arquivo .exe." }
  }
  if (Test-SumatraEhInstaladorPorNome $exe) {
    return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
  }

  $info = (Get-Item $exe).VersionInfo
  $produto = [string]$info.ProductName
  $descricao = [string]$info.FileDescription
  if ($produto -and ($produto -notmatch "Sumatra")) {
    return @{ Ok = $false; Erro = "O arquivo nao parece ser o SumatraPDF." }
  }
  if ($descricao -match "(?i)installer|setup") {
    return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
  }
  if (-not (Test-Path $dll)) {
    return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
  }
  if ((Get-Item $dll).Length -lt 1MB) {
    return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
  }
  return @{ Ok = $true; Exe = $exe; Dll = $dll; Erro = $null }
}

function Test-SumatraAceitaPrintTo([string]$exe) {
  $pdf = Join-Path ([IO.Path]::GetTempPath()) ("ultrapdv-sumatra-validacao-" + [guid]::NewGuid().ToString("n") + ".pdf")
  Set-Content -Path $pdf -Value "%PDF-1.4`n1 0 obj<<>>endobj`ntrailer<<>>`n%%EOF`n" -Encoding ASCII
  try {
    $p = Start-Process -FilePath $exe -ArgumentList @(
      "-print-to", "__UltraPDV_Validacao__", "-silent", "-exit-when-done", $pdf
    ) -PassThru -WindowStyle Hidden -WorkingDirectory (Split-Path $exe)
    $saiu = $p.WaitForExit(12000)
    if (-not $saiu) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
    }
    return @{ Ok = $true; Erro = $null }
  } catch {
    return @{ Ok = $false; Erro = $script:MensagemMotorInstalador }
  } finally {
    Remove-Item $pdf -Force -ErrorAction SilentlyContinue
  }
}

function Assert-SumatraMotor([string]$pasta) {
  $check = Test-SumatraPastaMotor $pasta
  if (-not $check.Ok) {
    Write-Host "ERRO: $($check.Erro)" -ForegroundColor Red
    exit 1
  }
  $cli = Test-SumatraAceitaPrintTo $check.Exe
  if (-not $cli.Ok) {
    Write-Host "ERRO: $($cli.Erro)" -ForegroundColor Red
    exit 1
  }
}

function Copy-SumatraMotorDeFonte([string]$origemPasta, [string]$destinoPasta) {
  New-Item -ItemType Directory -Force -Path $destinoPasta | Out-Null
  Copy-Item (Join-Path $origemPasta "SumatraPDF.exe") (Join-Path $destinoPasta "SumatraPDF.exe") -Force
  Copy-Item (Join-Path $origemPasta "libmupdf.dll") (Join-Path $destinoPasta "libmupdf.dll") -Force
}

function Find-SumatraFonteValida([string]$raizAgente) {
  $candidatos = @(
    (Join-Path $raizAgente "bin"),
    (Join-Path ${env:ProgramFiles} "SumatraPDF"),
    (Join-Path ${env:ProgramFiles(x86)} "SumatraPDF")
  ) | Where-Object { $_ }
  foreach ($pasta in $candidatos) {
    $check = Test-SumatraPastaMotor $pasta
    if ($check.Ok) { return $pasta }
  }
  return $null
}

function Prepare-SumatraMotor([string]$raizAgente) {
  $bin = Join-Path $raizAgente "bin"
  $local = Test-SumatraPastaMotor $bin
  if ($local.Ok) { return $bin }

  $fonte = Find-SumatraFonteValida $raizAgente
  if (-not $fonte) {
    Write-Host "ERRO: $script:MensagemMotorInstalador" -ForegroundColor Red
    Write-Host ""
    Write-Host "O Setup precisa do executavel real do SumatraPDF e de libmupdf.dll."
    Write-Host "Neste computador de build, copie de:"
    Write-Host "  C:\Program Files\SumatraPDF\SumatraPDF.exe"
    Write-Host "  C:\Program Files\SumatraPDF\libmupdf.dll"
    Write-Host "para:"
    Write-Host "  print-agent\bin\"
    exit 1
  }

  if ($fonte -ne $bin) {
    Write-Host "Preparando motor a partir de $fonte"
    Copy-SumatraMotorDeFonte $fonte $bin
  }
  return $bin
}
