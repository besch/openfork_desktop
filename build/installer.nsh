; OpenFork custom NSIS installer includes

; ─── Modern UI Layout Options ────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_ABORTWARNING
!define MUI_HEADERIMAGE_RIGHT

; ─── Welcome Page ─────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Welcome to OpenFork"
!define MUI_WELCOMEPAGE_TEXT "Create and remix video content using local AI models.$\r$\n$\r$\nA one-time AI Engine setup (~4 GB) will be required on first launch.$\r$\n$\r$\nClick Next to continue."

; ─── Finish Page ──────────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "Launch OpenFork"
!define MUI_FINISHPAGE_TEXT "Installation complete.$\r$\n$\r$\nFollow the on-screen guide to finish the one-time AI engine setup.$\r$\n$\r$\nVisit openfork.ai for community workflows."

; ─── Abort Warning ────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING_TEXT "Cancel OpenFork installation?"

; ─── Custom Branding ──────────────────────────────────────────────────────────
BrandingText "OpenFork • Community AI Video"

; ─── Custom install/uninstall hooks ───────────────────────────────────────────
!macro customInstall
!macroend

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Remove the OpenFork AI Engine?$\r$\n$\r$\nThis will free ~10GB of disk space by deleting downloaded models and Docker data." \
    IDNO openfork_skip_engine_cleanup
  
  DetailPrint "Cleaning up AI Engine environment..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\uninstall-engine.ps1"'
  
  openfork_skip_engine_cleanup:
!macroend


