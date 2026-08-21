; UltraPDV Connector — instalador NSIS
Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel admin
ManifestDPIAware True

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "generated\version.nsh"

Name "${PRODUCT_NAME}"
OutFile "${SETUP_OUTFILE}"
InstallDir "$PROGRAMFILES64\UltraPDV Connector"
InstallDirRegKey HKLM "Software\UltraPDV\Connector" "InstallDir"
BrandingText "${PRODUCT_NAME} ${PRODUCT_VERSION}"

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileDescription" "UltraPDV Connector Setup"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o UltraPDV Connector"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o UltraPDV Connector neste computador.$\r$\n$\r$\nEle permite que o UltraPDV online imprima neste Windows. Você não precisa instalar Node.js nem SumatraPDF.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_LICENSEPAGE_TEXT_TOP "Revise a licença e os avisos de software de terceiros."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "UltraPDV Conector instalado com sucesso."
!define MUI_FINISHPAGE_TITLE "UltraPDV Conector instalado com sucesso."
!define MUI_FINISHPAGE_TEXT "O UltraPDV Connector está pronto neste computador.$\r$\n$\r$\nAbra o UltraPDV na web e vá em Configurações → Impressão."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchTestPage
!define MUI_FINISHPAGE_RUN_TEXT "Abrir página de teste do Conector"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\licenses\UltraPDV-Connector-EULA.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

Var VerifyCount

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "O UltraPDV Connector requer Windows 64 bits."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Function StopConnector
  IfFileExists "$INSTDIR\runtime\node.exe" 0 skip_stop
  IfFileExists "$INSTDIR\app\stop.mjs" 0 skip_stop
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\stop.mjs"'
  Sleep 800
  skip_stop:
FunctionEnd

Function LaunchTestPage
  Exec '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\verify.mjs" --open'
FunctionEnd

Section "UltraPDV Connector" SecPrincipal
  SectionIn RO
  SetRegView 64
  Call StopConnector

  SetOutPath "$INSTDIR\runtime"
  File "staging\runtime\node.exe"
  File /nonfatal "staging\runtime\LICENSE"

  SetOutPath "$INSTDIR\app"
  File "staging\app\*.mjs"
  File "staging\app\*.html"
  File "staging\app\version.json"

  SetOutPath "$INSTDIR\print-engine"
  File "staging\print-engine\SumatraPDF.exe"
  File "staging\print-engine\libmupdf.dll"

  SetOutPath "$INSTDIR\licenses"
  File /r "staging\licenses\*.*"

  SetOutPath "$INSTDIR\launcher"
  File "staging\launcher\start.vbs"
  File "staging\launcher\tray.ps1"

  SetOutPath "$INSTDIR\config"
  File "staging\config\origins.json"

  SetOutPath "$INSTDIR"
  File "staging\version.json"
  File "staging\THIRD-PARTY-NOTICES.txt"

  CreateDirectory "$INSTDIR\data"
  nsExec::ExecToLog 'icacls "$INSTDIR\data" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  ReadEnvStr $1 PROGRAMDATA
  CreateDirectory "$1\UltraPDV"
  nsExec::ExecToLog 'icacls "$1\UltraPDV" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'

  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\identidade.mjs" --ensure'

  WriteRegStr HKLM "Software\UltraPDV\Connector" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\UltraPDV\Connector" "Version" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "UltraPDVConnector" '"$SYSDIR\wscript.exe" //nologo "$INSTDIR\launcher\start.vbs"'

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "DisplayName" "UltraPDV Connector"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "NoRepair" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector" "EstimatedSize" 110000

  nsExec::ExecToLog '"$SYSDIR\wscript.exe" //nologo "$INSTDIR\launcher\start.vbs"'

  StrCpy $VerifyCount 0
  verify_loop:
    IntOp $VerifyCount $VerifyCount + 1
    nsExec::ExecToStack '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\verify.mjs"'
    Pop $0
    Pop $1
    IntCmp $0 0 verify_ok
    IntCmp $VerifyCount 25 verify_fail
    Sleep 400
    Goto verify_loop
  verify_fail:
    MessageBox MB_OK|MB_ICONEXCLAMATION "O UltraPDV Connector foi instalado, mas ainda não respondeu no teste local. Tente abrir Configurações → Impressão no UltraPDV ou reiniciar o Windows."
    Goto verify_done
  verify_ok:
  verify_done:
SectionEnd

Section "Uninstall"
  SetRegView 64
  Call un.StopConnector

  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "UltraPDVConnector"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\UltraPDVConnector"
  DeleteRegKey HKLM "Software\UltraPDV\Connector"
  ReadEnvStr $1 PROGRAMDATA
  Delete "$1\UltraPDV\print-agent.json"
  Delete "$1\UltraPDV\print-agent.log"

  RMDir /r "$INSTDIR"
SectionEnd

Function un.StopConnector
  IfFileExists "$INSTDIR\runtime\node.exe" 0 skip_un_stop
  IfFileExists "$INSTDIR\app\stop.mjs" 0 skip_un_stop
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\stop.mjs"'
  Sleep 800
  skip_un_stop:
FunctionEnd
