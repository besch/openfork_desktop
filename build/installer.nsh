; OpenFork custom NSIS installer includes

; ─── Modern UI Layout Options ────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_ABORTWARNING
!ifndef MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_RIGHT
!endif

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

!macro openforkCleanupEngine
  Var /GLOBAL OpenForkCleanupExitCode
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Remove the OpenFork AI Engine?$\r$\n$\r$\nThis will delete:$\r$\n• WSL distro (OpenFork)$\r$\n• Docker data and models (~10GB)$\r$\n• Registry entries$\r$\n$\r$\nKeep your custom Docker/NVIDIA setup intact." \
    IDNO openfork_skip_engine_cleanup
  
  DetailPrint "Cleaning up AI Engine environment..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\uninstall-engine.ps1"' $OpenForkCleanupExitCode
  ${If} $OpenForkCleanupExitCode <> 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "AI Engine cleanup did not finish successfully.$\r$\n$\r$\nThe OpenFork WSL distro may still be present after uninstall."
  ${EndIf}
  
  openfork_skip_engine_cleanup:
!macroend

!macro customRemoveFiles
  ; Run while $INSTDIR still exists. electron-builder's customUnInstall hook runs
  ; after RMDir /r $INSTDIR, which would delete resources\bin\uninstall-engine.ps1.
  ${ifNot} ${isUpdated}
    !insertmacro openforkCleanupEngine
  ${endif}

  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  RMDir /r $INSTDIR
!macroend


