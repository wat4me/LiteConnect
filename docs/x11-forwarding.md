# Automatic SSH graphical forwarding

Terminal SSH connections default to automatic graphical forwarding on Windows,
macOS and Linux. Each connection can explicitly select Off or Custom. Existing
enabled custom displays are preserved; legacy unchecked defaults become Auto.
Import/export preserves the explicit mode, including OpenSSH `ForwardX11 no`.
Background monitoring and AI-only SSH connections explicitly disable forwarding.

| Local platform | Display provider | First use |
| --- | --- | --- |
| Windows | Bundled portable VcXsrv, started on demand | No separate installation |
| macOS | Installed XQuartz, activated on demand | Install XQuartz and log out/in if its launch agent is not available |
| Linux | Current desktop’s Xorg or XWayland | Run from a graphical desktop with X11 compatibility available |

The remote server must permit X11 forwarding and have xauth available. Remote
applications open as ordinary local desktop windows. Missing local components,
authentication failures and remote refusal fall back to an ordinary shell with
an explanation. Reconnect an existing SSH session after enabling forwarding.

## macOS

Settings → Connections → Graphical interface detects XQuartz and offers its
[official installation page](https://www.xquartz.org/) when it is absent. The
application does not run an installer or modify system preferences automatically.

LiteConnect reads DISPLAY from the inherited environment or launchctl. It handles
launchd socket paths, including the display number in the filename and optional
screen suffixes. Existing launchd sockets are activated directly; otherwise the
installed XQuartz application is opened in the background. An authenticated
handshake must succeed before SSH is offered X11 forwarding. XQuartz is a shared
system display and is never terminated when LiteConnect closes.

See the [XQuartz FAQ](https://www.xquartz.org/FAQs.html) for launchd DISPLAY and
first-installation troubleshooting. No TCP listener, `xhost +`, authentication
disablement or changes to the user’s XQuartz startup preferences are required.

## Linux

LiteConnect reads the desktop’s DISPLAY and XAUTHORITY. If desktop-launched
applications lack these variables, it consults the user service environment
without exposing unrelated environment variables. It does not replace an
explicit display with credentials from a different display session.

Local displays use `/tmp/.X11-unix/Xn`, with Linux abstract sockets as a fallback.
Loopback TCP displays are also supported. MIT-MAGIC-COOKIE-1 credentials are read
from the selected authority file, matching the display number and local host.
New SSH connections reread the file so rotated credentials are not cached.

The application reuses the desktop display and never launches or terminates
Xorg/XWayland. If no display session is available, start LiteConnect from the
graphical desktop. A Wayland desktop needs its distribution’s XWayland component;
see [Wayland’s X11 compatibility documentation](https://wayland.freedesktop.org/docs/book/Xwayland.html).

## Authentication and verification

Each SSH connection receives a fresh fake cookie. The forwarding stream checks
the remote setup message and substitutes the desktop’s real cookie. Both byte
orders and fragmented setup messages are supported. Desktop cookies remain in
the main process and are never sent to renderer IPC, printed, or exported.

The settings self-test now validates the actual local display on all three
platforms, independently of SSH. A successful local test does not validate remote
sshd configuration or remote application dependencies. Windows advanced executable
selection remains Windows-only; Unix desktops use their own display session.

Tests cover DISPLAY parsing, authority records, Linux session-variable recovery,
XQuartz activation/startup, missing dependencies, rotated credentials, shutdown,
and authenticated forwarding over a real local IPC stream. The Electron UI
fixture checks all three platform variants in Chinese and English. On Windows,
the real SSH + portable VcXsrv + native xclock smoke test is also available.
macOS XQuartz and Linux graphical desktops still require native-machine testing;
simulated environment tests and Windows named pipes do not replace that check.
