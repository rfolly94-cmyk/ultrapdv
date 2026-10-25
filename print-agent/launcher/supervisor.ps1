param(
  [Parameter(Mandatory = $true)][string]$Node,
  [Parameter(Mandatory = $true)][string]$Entrada,
  [Parameter(Mandatory = $true)][string]$Diretorio
)

$ErrorActionPreference = "Stop"
$env:ULTRAPDV_SUPERVISOR = "1"
$env:ULTRAPDV_INSTALL_DIR = $Diretorio
if ($env:ULTRAPDV_CONFIG_DIR) {
  Remove-Item Env:ULTRAPDV_CONFIG_DIR
}

while ($true) {
  $processo = Start-Process -FilePath $Node -ArgumentList @("`"$Entrada`"") -WorkingDirectory $Diretorio -Wait -PassThru -NoNewWindow
  if ($null -eq $processo.ExitCode -or $processo.ExitCode -ne 75) {
    if ($null -eq $processo.ExitCode) { exit 1 }
    exit $processo.ExitCode
  }
  Start-Sleep -Seconds 1
}
