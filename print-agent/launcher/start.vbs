Option Explicit
Dim fso, sh, raiz, node, app
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
raiz = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = raiz & "\runtime\node.exe"
app = raiz & "\app\server.mjs"
If Not fso.FileExists(node) Then WScript.Quit 1
If Not fso.FileExists(app) Then WScript.Quit 1
sh.CurrentDirectory = raiz
sh.Environment("Process")("ULTRAPDV_INSTALL_DIR") = raiz
sh.Run """" & node & """ """ & app & """", 0, False
