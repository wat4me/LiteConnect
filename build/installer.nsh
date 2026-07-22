; Migrate Electron userData from package name lite-ssh → lite-connect.
; Electron on Windows uses app name from package.json "name" (not productName),
; so paths are: %APPDATA%\lite-ssh  and  %APPDATA%\lite-connect
; Runs at install; skips when destination already has connection data.
; perMachine: false — $APPDATA is the installing user's Roaming profile.

!macro customInstall
  Push $R0
  Push $R1
  Push $R2

  StrCpy $R0 "$APPDATA\lite-ssh"
  StrCpy $R1 "$APPDATA\lite-connect"

  ; Destination already has real app data — do not overwrite
  IfFileExists "$R1\connections.json" liteconnect_migrate_done 0
  IfFileExists "$R1\db-connections.json" liteconnect_migrate_done 0
  IfFileExists "$R1\groups.json" liteconnect_migrate_done 0

  ; No legacy folder
  IfFileExists "$R0\*.*" 0 liteconnect_migrate_done

  CreateDirectory "$R1"
  ; Recursive copy (nested dirs e.g. ai-history)
  nsExec::ExecToLog 'cmd /c xcopy /E /I /Y /Q "$APPDATA\lite-ssh\*" "$APPDATA\lite-connect\"'
  Pop $R2
  DetailPrint "LiteConnect: migrated userData lite-ssh -> lite-connect (exit $R2)"

  liteconnect_migrate_done:
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
