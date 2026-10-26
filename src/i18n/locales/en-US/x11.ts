export default {
  x11: {
    autoStarted: 'Started the local display server automatically ({host}:{port}).',
    skipped: 'Graphical forwarding was skipped: {detail}',
    notReady: 'The local display server is not ready',
    autoStartDisabled:
      'The local display server is not ready, and automatic start is off. Start VcXsrv or Xming manually, or turn on "Start the local display server when connecting" in Settings.',
    platformUnsupported: 'This system cannot start a display server automatically. Install and start one yourself (for example, XQuartz on macOS).',
    notFound:
      'VcXsrv or Xming was not found. Install VcXsrv (recommended), or set the vcxsrv.exe path under Settings → Connections → Graphical interface.',
    notFoundPrompt:
      'No local display server (VcXsrv or Xming) was detected. You can install the VcXsrv bundled with LiteConnect under Settings → Connections, or save the connection anyway (graphical programs may not open when you connect).',
    stillNotReady:
      'Tried to reach the display server, but {host}:{port} did not complete the X11 handshake. An open port does not mean it is a display server.',
    startedButTimeout:
      'Tried to start {exe}, but {host}:{port} did not complete the X11 handshake within {seconds}s. Check the firewall and whether the display number is in use, or confirm in Task Manager that vcxsrv.exe is running.',
    startExited:
      'Tried to start {exe}, but the process exited quickly ({detail}) and {host}:{port} did not complete the X11 handshake. Run VcXsrv once manually to see the error, or use a different display number.',
    startFailed: 'Could not start the local display server: {error}',
    portOccupiedNotX11:
      'A process is still accepting connections on {host}:{port}, but it did not complete the X11 handshake, so it is not a usable display server. Check the process using that port, or use display number 1 (port 6001).',
    portOccupiedResidualX:
      'This looks like a leftover display server: {process} still holds {host}:{port} but can no longer complete the X11 handshake. This often happens when VcXsrv is closed manually and the process does not exit fully. End that process and try again, or choose End leftover processes in Settings.',
    portOccupiedOtherProcess:
      '{host}:{port} is used by another program, {process}, which is not an X11 display server. End that program, or change the connection display number to 1 (port 6001).',
    residualKillOk: 'Ended leftover process {process}. Test the local display server again.',
    residualKillFailed: 'Could not end the process: {error}',
    residualKillNotAllowed: 'Only leftover processes identified as VcXsrv, Xming, or a similar display server can be ended.',
    recheckFailed:
      'The local display server did not stay available at {host}:{port} during the connection. {detail}',
    channelFailed: 'Graphical forwarding failed: {error}',
    connectLocalFailed: 'Graphical forwarding failed: could not connect to the local display server {host}:{port} ({error})',
    shellRejected:
      'The remote host refused X11 forwarding ({detail}). Connected with a normal terminal instead. Check that sshd allows X11Forwarding and that xauth is installed on the remote host.',
    shellRejectedLocalUnavailable:
      'The remote host refused X11 forwarding ({detail}), and {host}:{port} is not listening locally. Connected with a normal terminal instead. Confirm that VcXsrv is running, and check X11Forwarding and xauth on the server.',
    selectExeTitle: 'Choose the local display server executable',
  },
}
