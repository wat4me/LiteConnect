# UI regression checks

Run `npm run test:ui` after installing the project's existing dependencies.

The script starts a temporary Vite server without the application's Electron
plugin, then opens an invisible Electron window with actual Vue components.
It uses a temporary profile and mocked connection IPC; it never connects to a
server or reads/writes real connection settings. The window closes after the
checks, and the server is shut down even when a check fails.

The checks cover default group collapse, current/all-group search, Enter to
connect, toolbar menu dismissal and focus return, sidebar pointer/keyboard
resize, narrow window overflow, and selection/tag colors across dark, light,
eyecare and custom themes (including live accent token overrides). They also cover
dragging a card's text into a collapsed group, preventing drags from
action buttons, bookmark rename, AI stage/delay rendering, SFTP edit conflict
and explicit overwrite with optional backup, directory upload selection, and
long text/count layout. Bookmark layout
is checked with Chinese, Latin, mixed, and long names at three widths and three
zoom factors. A screenshot is retained in the temporary artifact directory
printed at completion.

These checks validate renderer interactions and layout. Real SSH/SFTP network
operations, native OS dragging, and tooltips still need integration/manual QA.
