# Desenvolvimento apenas. O cliente usa UltraPDV-Conector-Setup.exe.
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$alvo = Join-Path $raiz "src\server.mjs"
$startup = [Environment]::GetFolderPath("Startup")
$atalho = Join-Path $startup "UltraPDV Print Agent.lnk"

if (-not (Test-Path $alvo)) {
  throw "Print Agent nao encontrado: $alvo"
}

$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($atalho)
$s.TargetPath = (Get-Command node).Source
$s.Arguments = "`"$alvo`""
$s.WorkingDirectory = $raiz
$s.WindowStyle = 7
$s.Description = "UltraPDV Print Agent (somente 127.0.0.1)"
$s.Save()

Write-Host "Atalho criado em $atalho"
Write-Host "O agente iniciara com o Windows para este usuario."
