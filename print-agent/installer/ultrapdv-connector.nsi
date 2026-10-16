; UltraPDV Connector â€” instalador NSIS
Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel admin
ManifestDPIAware True

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "generated\version.nsh"
!cd "${__FILEDIR__}"

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
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o UltraPDV Connector neste computador.$\r$\n$\r$\nEle permite que o UltraPDV online imprima neste Windows. VocÃª nÃ£o precisa instalar Node.js nem SumatraPDF.$\r$\n$\r$\nClique em AvanÃ§ar para continuar."
!define MUI_LICENSEPAGE_TEXT_TOP "Revise a licenÃ§a e os avisos de software de terceiros."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "UltraPDV Conector instalado com sucesso."
!define MUI_FINISHPAGE_TITLE "UltraPDV Conector instalado com sucesso."
!define MUI_FINISHPAGE_TEXT "O UltraPDV Connector estÃ¡ pronto neste computador.$\r$\n$\r$\nAbra o UltraPDV na web e vÃ¡ em ConfiguraÃ§Ãµes â†’ ImpressÃ£o."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchTestPage
!define MUI_FINISHPAGE_RUN_TEXT "Abrir pÃ¡gina de teste do Conector"
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
Var FezBackup

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

Function BackupConnectorAnterior
  StrCpy $FezBackup "0"
  ReadEnvStr $1 PROGRAMDATA
  IfFileExists "$INSTDIR\app\server.mjs" 0 backup_fim
  CreateDirectory "$1\UltraPDV\backup-connector\anterior\app"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\app\*.*" "$1\UltraPDV\backup-connector\anterior\app\"
  IfErrors backup_falhou
  CopyFiles /SILENT "$INSTDIR\version.json" "$1\UltraPDV\backup-connector\anterior\version.json"
  StrCpy $FezBackup "1"
  Goto backup_fim
  backup_falhou:
    nsExec::ExecToLog '"$SYSDIR\wscript.exe" //nologo "$INSTDIR\launcher\start.vbs"'
    MessageBox MB_OK|MB_ICONSTOP "Nao foi possivel guardar a copia do Connector atual. A atualizacao foi interrompida e nenhum arquivo novo foi gravado."
    Abort
  backup_fim:
FunctionEnd

Function RestaurarConnectorAnterior
  ReadEnvStr $1 PROGRAMDATA
  StrCmp $FezBackup "1" 0 restaurar_fim
  Call StopConnector
  CopyFiles /SILENT "$1\UltraPDV\backup-connector\anterior\app\*.*" "$INSTDIR\app\"
  CopyFiles /SILENT "$1\UltraPDV\backup-connector\anterior\version.json" "$INSTDIR\version.json"
  nsExec::ExecToLog '"$SYSDIR\wscript.exe" //nologo "$INSTDIR\launcher\start.vbs"'
  restaurar_fim:
FunctionEnd

Section "UltraPDV Connector" SecPrincipal
  SectionIn RO
  SetRegView 64
  SetOverwrite on
  Call StopConnector
  Call BackupConnectorAnterior

  SetOutPath "$INSTDIR\runtime"
  File "${STAGING_DIR}\runtime\node.exe"
  File /nonfatal "${STAGING_DIR}\runtime\LICENSE"

  SetOutPath "$INSTDIR\app"
  File "${STAGING_DIR}\app\*.mjs"
  File "${STAGING_DIR}\app\*.html"
  File "${STAGING_DIR}\app\version.json"

  ; Acrescenta somente o executavel desta versao.
  ; Executaveis TEF anteriores permanecem no diretorio para rollback.
  ; SetOverwrite on substitui arquivo de mesmo nome. Um agente antigo
  ; bloqueado pelo Windows nao entra neste File e nao e tocado.
  SetOutPath "$INSTDIR\bin\tef"
  File "${STAGING_DIR}\bin\tef\${TEF_EXE_NAME}"

  SetOutPath "$INSTDIR\print-engine"
  File "${STAGING_DIR}\print-engine\SumatraPDF.exe"
  File "${STAGING_DIR}\print-engine\libmupdf.dll"

  SetOutPath "$INSTDIR\licenses"
  File /r "${STAGING_DIR}\licenses\*.*"

  SetOutPath "$INSTDIR\launcher"
  File "${STAGING_DIR}\launcher\start.vbs"
  File "${STAGING_DIR}\launcher\tray.ps1"

  SetOutPath "$INSTDIR\config"
  File "${STAGING_DIR}\config\origins.json"

  SetOutPath "$INSTDIR"
  File "${STAGING_DIR}\version.json"
  File "${STAGING_DIR}\tef-pacote.json"
  File "${STAGING_DIR}\THIRD-PARTY-NOTICES.txt"

  CreateDirectory "$INSTDIR\data"
  nsExec::ExecToLog 'icacls "$INSTDIR\data" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  ; A biblioteca grava logs na pasta ja instalada. Usuarios recebem Modify.
  ; Nenhum arquivo dessa pasta e apagado ou recolocado.
  CreateDirectory "$INSTDIR\bin\tef\producao"
  CreateDirectory "$INSTDIR\bin\tef\TEF"
  nsExec::ExecToLog 'icacls "$INSTDIR\bin\tef\producao" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  nsExec::ExecToLog 'icacls "$INSTDIR\bin\tef\TEF" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  ; Atualizacao: cria ProgramData se faltar e nao apaga configuracao,
  ; chave Ed25519, journal, prova, vinculo nem pareamento.
  ReadEnvStr $1 PROGRAMDATA
  CreateDirectory "$1\UltraPDV"
  CreateDirectory "$1\UltraPDV\TEF\Producao"
  nsExec::ExecToLog 'icacls "$1\UltraPDV" /grant *S-1-5-32-545:(OI)(CI)M /C /Q'
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\tef-preparar-pasta.mjs"'

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
    Call RestaurarConnectorAnterior
    MessageBox MB_OK|MB_ICONEXCLAMATION "O Connector novo nao respondeu. A copia anterior do programa foi restaurada. A pasta de trabalho do TEF, a chave e o vinculo nao foram alterados."
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
  ; A desinstalacao nao apaga tef-chave.json, tef-pendencia.json,
  ; tef-recuperacao.json, tef-vinculo.json, tef-pareamento.json,
  ; tef-biblioteca.json, tef-pasta.json, backup-connector nem a pasta TEF\Producao.
  ReadEnvStr $1 PROGRAMDATA
  Delete "$1\UltraPDV\print-agent.json"
  Delete "$1\UltraPDV\print-agent.log"

  ; O diretorio de trabalho do TEF fica em bin\tef\TEF.
  ; Os executaveis UltraPDVTef_*.exe e device.json nao sao apagados.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\print-engine"
  RMDir /r "$INSTDIR\licenses"
  RMDir /r "$INSTDIR\launcher"
  RMDir /r "$INSTDIR\config"
  Delete "$INSTDIR\version.json"
  Delete "$INSTDIR\tef-pacote.json"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\bin\tef"
  RMDir "$INSTDIR\bin"
  RMDir "$INSTDIR"
SectionEnd

Function un.StopConnector
  IfFileExists "$INSTDIR\runtime\node.exe" 0 skip_un_stop
  IfFileExists "$INSTDIR\app\stop.mjs" 0 skip_un_stop
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\stop.mjs"'
  Sleep 800
  skip_un_stop:
FunctionEnd
