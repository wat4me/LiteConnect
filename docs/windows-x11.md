# Windows automatic graphical forwarding

Windows SSH terminal connections default to automatic X11 forwarding. Legacy
connections saved with the old unchecked default also use automatic forwarding;
an existing enabled custom display stays custom. The connection form offers
Automatic, Off, and Custom modes. The explicit mode survives export/import.
macOS and Linux also default to automatic forwarding, using their existing
desktop display services. See [cross-platform integration](x11-forwarding.md).
Monitoring and AI-only connections explicitly disable X11.

Graphical Linux installers open as ordinary Windows desktop windows. There is no
embedded graphical tab. Remote sshd must allow X11Forwarding and provide xauth;
LiteConnect does not change remote system configuration. A rejected X11 request
falls back to a normal shell and explains the reason in the terminal. Connections
opened before this change must reconnect to negotiate X11.

## Runtime and security

`npm run prepare:x11` verifies the tracked VcXsrv 1.20.14.0 installer and extracts
its portable runtime. It never executes that installer. The preparation script
downloads a checksum-pinned full 7-Zip extractor into node_modules/.cache when
needed; this build tool is not distributed. npm development commands prepare the
runtime automatically. The Windows electron-builder beforePack hook also
prepares and verifies it, including when packaging with --dir. The Windows build
must run on a Windows host. Other platforms do not include the runtime.

The application starts a dedicated display on the first free port for displays
50–99, and never adopts or kills an existing display. The process loads sibling
DLLs, fonts and keyboard resources from its own directory. Each process uses a
private temporary Xauthority file. Automatic mode never passes `-ac`; readiness
requires a successful authenticated setup and rejection of both wrong cookies
and anonymous connections. SSH receives a fresh fake cookie per connection;
the forwarding stream validates and replaces it with the private local cookie.
The local cookie and authority file are never sent to the renderer or logged.

One display process is reused for each executable. Testing a different draft
path leaves existing displays and their graphical windows running. Graceful app
exit stops owned processes and removes temporary authority files. A force-killed
application cannot run cleanup; it may leave its authenticated server and temp
directory behind. Another run selects a different free display.

Custom forwarding retains the existing external display workflow and its access
policy. Use automatic mode for managed authentication. The global auto-start
switch disables automatic mode; a connection can be disabled independently.

## Verification

`node scripts/check-x11-windows.mjs` runs the production ConnectionService against
an ephemeral local SSH2 fixture and the real portable VcXsrv. It checks automatic
negotiation, cookie replacement over the SSH channel, a native xclock window,
fresh cookies after reconnect, explicit opt-out, remote refusal fallback, port
collision handling and owned-process cleanup. It reads no saved connections or
credentials. Artifacts contain a result JSON and X window tree; temporary cookie
files are removed. This verifies the local Windows path, not every remote Linux
installer or a clean Windows VM installation.

`npm run test:ui -- --x11` checks the actual Vue connection form in Electron:
legacy defaults, explicit Off/Custom modes, saved mode values and the settings
self-test in Chinese and English. To rerun the transport smoke against an unpacked package,
set `LITECONNECT_X11_SMOKE_EXECUTABLE` to the packaged vcxsrv.exe path.
