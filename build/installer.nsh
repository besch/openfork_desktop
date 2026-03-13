; OpenFork custom NSIS installer includes
; Injected by electron-builder via nsis.include before MUI2 macros are processed.
; Only !define statements here — no executable code outside of macros.

; ─── Welcome Page ─────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Welcome to OpenFork"
!define MUI_WELCOMEPAGE_TEXT "OpenFork is an open source platform for community-driven video content creation using local AI models.$\r$\n$\r$\nOn first launch you will be guided through a one-time AI engine setup that downloads the required Docker environment (~4 GB).$\r$\n$\r$\nClick Next to continue."

; ─── Finish Page ──────────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "OpenFork Is Ready"
!define MUI_FINISHPAGE_TEXT "Installation complete.$\r$\n$\r$\nLaunch OpenFork and follow the on-screen guide to finish the one-time engine setup.$\r$\n$\r$\nVisit openfork.ai to explore community workflows and open source models."
!define MUI_FINISHPAGE_LINK "Visit openfork.ai"
!define MUI_FINISHPAGE_LINK_LOCATION "https://openfork.ai"

; ─── Abort Warning ────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel the OpenFork installation?"

; ─── Custom install/uninstall hooks (required by electron-builder template) ───
!macro customInstall
  ; Nothing extra needed at install time.
!macroend

!macro customUnInstall
  ; Ask whether to remove the AI Engine (WSL distro + all Docker data).
  ; The script is bundled at resources\bin\uninstall-engine.ps1.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you also want to remove the OpenFork AI Engine?$\r$\n$\r$\nThis will delete the WSL environment and all downloaded Docker images, freeing several GB of disk space.$\r$\n$\r$\nChoose No to keep the engine for a future reinstall." \
    IDNO openfork_skip_engine_cleanup
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\uninstall-engine.ps1"'
  openfork_skip_engine_cleanup:
!macroend
