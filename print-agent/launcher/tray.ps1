param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$UrlInicial
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-ConnectorUrl {
  try {
    if (Test-Path $ConfigPath) {
      $c = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
      if ($c.activePort) {
        return "http://127.0.0.1:$($c.activePort)/"
      }
    }
  } catch {}
  return $UrlInicial
}

function Invoke-LocalPost([string]$Path) {
  $url = (Get-ConnectorUrl).TrimEnd("/") + $Path
  try {
    Invoke-WebRequest -UseBasicParsing -Method POST -Uri $url -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null
  } catch {}
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "UltraPDV Conector"
$notify.Visible = $true
$notify.Icon = [System.Drawing.SystemIcons]::Application

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$abrir = $menu.Items.Add("Abrir configuracoes")
$abrir.Add_Click({ Start-Process (Get-ConnectorUrl) })

$testar = $menu.Items.Add("Testar impressao")
$testar.Add_Click({ Invoke-LocalPost "/print/teste" })

$reiniciar = $menu.Items.Add("Reiniciar conector")
$reiniciar.Add_Click({ Invoke-LocalPost "/restart" })

[void]$menu.Items.Add("-")

$sair = $menu.Items.Add("Sair")
$sair.Add_Click({
  Invoke-LocalPost "/shutdown"
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Start-Process (Get-ConnectorUrl) })

[System.Windows.Forms.Application]::Run()
$notify.Visible = $false
$notify.Dispose()
