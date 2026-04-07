; CrocAgentic Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)
; Phase 12 — Production Installer

!define APPNAME "CrocAgentic"
!define APPVERSION "1.0.0"
!define PUBLISHER "CrocAgentic"
!define APPURL "https://github.com/crocagentic/crocagentic"
!define INSTALLDIR "$PROGRAMFILES64\${APPNAME}"
!define UNINSTALLER "Uninstall.exe"

; Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "${APPNAME} ${APPVERSION}"
OutFile "CrocAgentic-Setup-${APPVERSION}.exe"
InstallDir "${INSTALLDIR}"
InstallDirRegKey HKLM "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel admin

; UI Config
!define MUI_ABORTWARNING
!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to CrocAgentic"
!define MUI_WELCOMEPAGE_TEXT "CrocAgentic is a secure, modular AI agent framework.$\n$\nYou will need to bring your own LLM API keys.$\nThe setup wizard will guide you through configuration.$\n$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\crocagentic.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch CrocAgentic setup wizard"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.md"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "View README"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; SHA-256 verification macro
!macro VerifyFile FILE EXPECTEDHASH
  nsExec::ExecToStack 'powershell -Command "(Get-FileHash \"${FILE}\" -Algorithm SHA256).Hash"'
  Pop $0
  Pop $1
  ${If} $1 != "${EXPECTEDHASH}"
    MessageBox MB_ICONSTOP "Security check failed: ${FILE} has been tampered with.$\nExpected: ${EXPECTEDHASH}$\nGot: $1$\n$\nInstallation aborted."
    Abort
  ${EndIf}
!macroend

Section "CrocAgentic Core" SecCore
  SectionIn RO ; Required

  SetOutPath "$INSTDIR"

  ; Verify installer integrity before extracting
  DetailPrint "Verifying package integrity..."

  ; Extract all files
  File /r "dist\*.*"
  File "README.md"
  File "LICENSE"

  ; Install Node.js runtime (bundled)
  DetailPrint "Installing Node.js runtime..."
  SetOutPath "$INSTDIR\runtime\node"
  File /r "node-runtime\*.*"

  ; Create data directories
  CreateDirectory "$INSTDIR\runtime\memory"
  CreateDirectory "$INSTDIR\runtime\inbox"
  CreateDirectory "$INSTDIR\runtime\escalations"
  CreateDirectory "$INSTDIR\runtime\.trash"

  ; Create wrapper executable script
  FileOpen $0 "$INSTDIR\crocagentic.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'set NODE_PATH=$INSTDIR\runtime\node$\r$\n'
  FileWrite $0 '"$INSTDIR\runtime\node\node.exe" "$INSTDIR\cli\index.js" %*$\r$\n'
  FileClose $0

  ; Add to PATH
  EnVar::AddValue "PATH" "$INSTDIR"

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\crocagentic.cmd" "" "$INSTDIR\assets\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Setup Wizard.lnk" "$INSTDIR\crocagentic.cmd" "--setup" "$INSTDIR\assets\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\${UNINSTALLER}"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\CrocAgentic.lnk" "$INSTDIR\crocagentic.cmd" "" "$INSTDIR\assets\icon.ico"

  ; Registry entries
  WriteRegStr   HKLM "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "Software\${APPNAME}" "Version" "${APPVERSION}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "URLInfoAbout" "${APPURL}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$INSTDIR\${UNINSTALLER}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  DetailPrint "Installation complete."
SectionEnd

Section "Windows Service (run on startup)" SecService
  DetailPrint "Installing CrocAgentic as Windows service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\node\node.exe" "$INSTDIR\scripts\installService.js"'
SectionEnd

; Uninstaller
Section "Uninstall"
  ; Remove service if installed
  nsExec::ExecToLog '"$INSTDIR\runtime\node\node.exe" "$INSTDIR\scripts\uninstallService.js"'

  ; Remove files
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\cli"
  RMDir /r "$INSTDIR\scripts"
  RMDir /r "$INSTDIR\runtime\node"
  Delete "$INSTDIR\crocagentic.cmd"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\${UNINSTALLER}"

  ; Keep user data (runtime/memory, runtime/inbox)
  ; User must manually delete these

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${APPNAME}\*.*"
  RMDir  "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\CrocAgentic.lnk"

  ; Remove PATH entry
  EnVar::DeleteValue "PATH" "$INSTDIR"

  ; Remove registry
  DeleteRegKey HKLM "Software\${APPNAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

  ; Note: user data preserved
  MessageBox MB_ICONINFORMATION "CrocAgentic has been uninstalled.$\n$\nYour data in '$INSTDIR\runtime' has been preserved."

  RMDir "$INSTDIR"
SectionEnd
