; CrocAgentic Windows Installer
; Built with NSIS — run: makensis installer\installer.nsi
; Requires assets\icon.ico to exist

!define APPNAME "CrocAgentic"
!define APPVERSION "1.0.0"
!define PUBLISHER "Harshal Vakharia"
!define APPURL "https://github.com/crocagentic/crocagentic"

; Use absolute path for icon — run from project root
!define ICON_PATH "assets\icon.ico"

Name "${APPNAME} ${APPVERSION}"
OutFile "CrocAgentic-Setup-${APPVERSION}.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"
!define MUI_WELCOMEPAGE_TITLE "Welcome to CrocAgentic ${APPVERSION}"
!define MUI_WELCOMEPAGE_TEXT "CrocAgentic is a secure AI agent framework.$\n$\nYou will need your own LLM API key (Gemini free / Claude / OpenAI) OR a local Ollama model.$\n$\nThe setup wizard runs on first launch.$\n$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\crocagentic.cmd"
!define MUI_FINISHPAGE_RUN_TEXT "Launch CrocAgentic"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "CrocAgentic" SecCore
  SectionIn RO

  SetOutPath "$INSTDIR"
  File /r "dist\*.*"
  File "README.md"
  File "LICENSE"
  File ".env.example"

  ; Node.js runtime
  SetOutPath "$INSTDIR\node-runtime"
  File /r "node-runtime\*.*"

  ; Create required directories
  CreateDirectory "$INSTDIR\runtime\memory"
  CreateDirectory "$INSTDIR\runtime\inbox"
  CreateDirectory "$INSTDIR\runtime\escalations"
  CreateDirectory "$INSTDIR\runtime\.trash"
  CreateDirectory "$INSTDIR\runtime\snapshots"

  ; Launcher script
  FileOpen $0 "$INSTDIR\crocagentic.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "cd /d $\"%~dp0\$\r$\n"
  FileWrite $0 "if not exist crocagentic.config.json ($\r$\n"
  FileWrite $0 "  echo First run detected. Starting setup wizard...$\r$\n"
  FileWrite $0 "  node-runtime\node.exe cli\index.js --setup$\r$\n"
  FileWrite $0 ")$\r$\n"
  FileWrite $0 "node-runtime\node.exe cli\index.js %*$\r$\n"
  FileClose $0

  ; Add to PATH
  EnVar::AddValue "PATH" "$INSTDIR"

  ; Shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\CrocAgentic CLI.lnk" "$SYSDIR\cmd.exe" '/k "$INSTDIR\crocagentic.cmd"' "$INSTDIR\${ICON_PATH}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\CrocAgentic Dashboard.lnk" "$INSTDIR\gui\src\index.html"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\CrocAgentic.lnk" "$SYSDIR\cmd.exe" '/k "$INSTDIR\crocagentic.cmd"' "$INSTDIR\${ICON_PATH}"

  ; Registry
  WriteRegStr   HKLM "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\crocagentic.cmd"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\cli"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\node-runtime"
  ; Keep user data: runtime/memory, runtime/inbox
  Delete "$SMPROGRAMS\${APPNAME}\*.*"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\CrocAgentic.lnk"
  EnVar::DeleteValue "PATH" "$INSTDIR"
  DeleteRegKey HKLM "Software\${APPNAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  MessageBox MB_ICONINFORMATION "CrocAgentic uninstalled.$\nYour data in runtime\ has been preserved."
  RMDir "$INSTDIR"
SectionEnd
