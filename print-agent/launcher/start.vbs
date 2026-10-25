Option Explicit
Dim fso, sh, raiz, node, app, supervisor
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = raiz & "\runtime\node.exe"
app = raiz & "\app\server.mjs"
supervisor = raiz & "\launcher\supervisor.ps1"
If Not fso.FileExists(node) Then WScript.Quit 1
If Not fso.FileExists(app) Then WScript.Quit 1
If Not fso.FileExists(supervisor) Then WScript.Quit 1
sh.CurrentDirectory = raiz
sh.Environment("Process")("ULTRAPDV_INSTALL_DIR") = raiz
sh.Environment("Process")("ULTRAPDV_SUPERVISOR") = "1"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & supervisor & """ -Node """ & node & """ -Entrada """ & app & """ -Diretorio """ & raiz & """", 0, False
