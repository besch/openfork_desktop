; OpenFork custom NSIS installer includes
; Injected by electron-builder via nsis.include before MUI2 macros are processed.

; ─── Modern UI Layout Options ────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_ABORTWARNING
!define MUI_HEADERIMAGE_RIGHT

; ─── Welcome Page ─────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Experience Community-Driven AI creation"
!define MUI_WELCOMEPAGE_TEXT "OpenFork is an open-source platform where creators collaborate to build and remix video content using local AI.$\r$\n$\r$\n$\r$\nOn your first launch, we will guide you through a one-time setup:$\r$\n  •  Local AI Engine installation (~4 GB)$\r$\n  •  Hardware optimization for your GPU$\r$\n  •  Model synchronization with the community$\r$\n$\r$\nClick Next to start your creative journey."

; ─── Finish Page ──────────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "Launch and Create"
!define MUI_FINISHPAGE_TEXT "The installation is complete.$\r$\n$\r$\nOpenFork will now help you finish the one-time AI Engine setup. This ensures your local environment is perfectly tuned for production.$\r$\n$\r$\n$\r$\nJoin the movement at openfork.ai to explorer community workflows and open source models."

; Added a direct link to the community site
!define MUI_FINISHPAGE_LINK "Visit OpenFork Community"
!define MUI_FINISHPAGE_LINK_LOCATION "https://openfork.ai/"

; ─── Abort Warning ────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING_TEXT "Are you sure you want to exit the OpenFork installation? Your progress will stay saved but the app won't be ready."

; ─── Custom Branding ──────────────────────────────────────────────────────────
BrandingText "OpenFork • empower. create. remix."

; ─── Custom install/uninstall hooks ───────────────────────────────────────────
!macro customInstall
  ; Standard installation behavior
!macroend

!macro customUnInstall
  ; Ask whether to remove the AI Engine (WSL distro + all Docker data).
  ; The script is bundled at resources\bin\uninstall-engine.ps1.
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Do you also want to remove the OpenFork AI Engine?$\r$\n$\r$\nThis will PERMANENTLY delete models and Docker images, freeing ~10GB+ of disk space.$\r$\n$\r$\nChoose No to keep the engine for a future reinstall." \
    IDNO openfork_skip_engine_cleanup
  
  DetailPrint "Cleaning up AI Engine environment..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\uninstall-engine.ps1"'
  
  openfork_skip_engine_cleanup:
!macroend

