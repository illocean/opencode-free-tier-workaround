' start-shim.vbs — launch the OpenCode free-tier shim hidden (no console window).
' Standalone helper process on 127.0.0.1:8791 for OmniRoute. Does not touch
' OmniRoute or OpenCode; safe to start independently and at logon.
Dim sh, fso, shimDir
shimDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\.."
shimDir = CreateObject("Scripting.FileSystemObject").GetAbsolutePathName(shimDir & "\shim")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = shimDir
' 0 = hidden window, False = don't wait
sh.Run "cmd.exe /c node opencode-free-shim.cjs", 0, False
