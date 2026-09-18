/** Per-command common flags / subcommands for docker-like option help. */

export type ShellFlagItem = {
  /** Flag or subcommand token, e.g. `-a`, `--all`, `aux` */
  flag: string
  /** i18n key under shellSuggest.flag.<cmd>.<id> or shared */
  descKey: string
}

/** Map: command name (lowercase) → flags. Order = display priority. */
export const SHELL_COMMAND_FLAGS: Record<string, ShellFlagItem[]> = {
  ls: [
    { flag: '-a', descKey: 'shellSuggest.flag.ls.a' },
    { flag: '-A', descKey: 'shellSuggest.flag.ls.A' },
    { flag: '-l', descKey: 'shellSuggest.flag.ls.l' },
    { flag: '-h', descKey: 'shellSuggest.flag.ls.h' },
    { flag: '-t', descKey: 'shellSuggest.flag.ls.t' },
    { flag: '-r', descKey: 'shellSuggest.flag.ls.r' },
    { flag: '-S', descKey: 'shellSuggest.flag.ls.S' },
    { flag: '-R', descKey: 'shellSuggest.flag.ls.R' },
    { flag: '-1', descKey: 'shellSuggest.flag.ls.one' },
    { flag: '-lah', descKey: 'shellSuggest.flag.ls.lah' },
    { flag: '-lt', descKey: 'shellSuggest.flag.ls.lt' },
  ],
  ps: [
    { flag: 'aux', descKey: 'shellSuggest.flag.ps.aux' },
    { flag: '-ef', descKey: 'shellSuggest.flag.ps.ef' },
    { flag: '-u', descKey: 'shellSuggest.flag.ps.u' },
    { flag: '-p', descKey: 'shellSuggest.flag.ps.p' },
    { flag: '-C', descKey: 'shellSuggest.flag.ps.C' },
  ],
  rm: [
    { flag: '-r', descKey: 'shellSuggest.flag.rm.r' },
    { flag: '-f', descKey: 'shellSuggest.flag.rm.f' },
    { flag: '-rf', descKey: 'shellSuggest.flag.rm.rf' },
    { flag: '-i', descKey: 'shellSuggest.flag.rm.i' },
    { flag: '-v', descKey: 'shellSuggest.flag.rm.v' },
  ],
  cp: [
    { flag: '-a', descKey: 'shellSuggest.flag.cp.a' },
    { flag: '-r', descKey: 'shellSuggest.flag.cp.r' },
    { flag: '-i', descKey: 'shellSuggest.flag.cp.i' },
    { flag: '-v', descKey: 'shellSuggest.flag.cp.v' },
    { flag: '-n', descKey: 'shellSuggest.flag.cp.n' },
  ],
  mv: [
    { flag: '-i', descKey: 'shellSuggest.flag.mv.i' },
    { flag: '-f', descKey: 'shellSuggest.flag.mv.f' },
    { flag: '-v', descKey: 'shellSuggest.flag.mv.v' },
    { flag: '-n', descKey: 'shellSuggest.flag.mv.n' },
  ],
  mkdir: [
    { flag: '-p', descKey: 'shellSuggest.flag.mkdir.p' },
    { flag: '-v', descKey: 'shellSuggest.flag.mkdir.v' },
    { flag: '-m', descKey: 'shellSuggest.flag.mkdir.m' },
  ],
  chmod: [
    { flag: '-R', descKey: 'shellSuggest.flag.chmod.R' },
    { flag: '-v', descKey: 'shellSuggest.flag.chmod.v' },
    { flag: '755', descKey: 'shellSuggest.flag.chmod.mode755' },
    { flag: '644', descKey: 'shellSuggest.flag.chmod.mode644' },
  ],
  chown: [
    { flag: '-R', descKey: 'shellSuggest.flag.chown.R' },
    { flag: '-v', descKey: 'shellSuggest.flag.chown.v' },
  ],
  grep: [
    { flag: '-i', descKey: 'shellSuggest.flag.grep.i' },
    { flag: '-n', descKey: 'shellSuggest.flag.grep.n' },
    { flag: '-r', descKey: 'shellSuggest.flag.grep.r' },
    { flag: '-R', descKey: 'shellSuggest.flag.grep.R' },
    { flag: '-v', descKey: 'shellSuggest.flag.grep.v' },
    { flag: '-E', descKey: 'shellSuggest.flag.grep.E' },
    { flag: '-l', descKey: 'shellSuggest.flag.grep.l' },
  ],
  find: [
    { flag: '-name', descKey: 'shellSuggest.flag.find.name' },
    { flag: '-type', descKey: 'shellSuggest.flag.find.type' },
    { flag: '-mtime', descKey: 'shellSuggest.flag.find.mtime' },
    { flag: '-size', descKey: 'shellSuggest.flag.find.size' },
    { flag: '-exec', descKey: 'shellSuggest.flag.find.exec' },
  ],
  tail: [
    { flag: '-f', descKey: 'shellSuggest.flag.tail.f' },
    { flag: '-n', descKey: 'shellSuggest.flag.tail.n' },
    { flag: '-F', descKey: 'shellSuggest.flag.tail.F' },
  ],
  head: [
    { flag: '-n', descKey: 'shellSuggest.flag.head.n' },
  ],
  df: [
    { flag: '-h', descKey: 'shellSuggest.flag.df.h' },
    { flag: '-T', descKey: 'shellSuggest.flag.df.T' },
    { flag: '-i', descKey: 'shellSuggest.flag.df.i' },
  ],
  du: [
    { flag: '-h', descKey: 'shellSuggest.flag.du.h' },
    { flag: '-s', descKey: 'shellSuggest.flag.du.s' },
    { flag: '-sh', descKey: 'shellSuggest.flag.du.sh' },
    { flag: '-a', descKey: 'shellSuggest.flag.du.a' },
  ],
  free: [
    { flag: '-h', descKey: 'shellSuggest.flag.free.h' },
    { flag: '-m', descKey: 'shellSuggest.flag.free.m' },
    { flag: '-g', descKey: 'shellSuggest.flag.free.g' },
  ],
  tar: [
    { flag: '-czf', descKey: 'shellSuggest.flag.tar.czf' },
    { flag: '-xzf', descKey: 'shellSuggest.flag.tar.xzf' },
    { flag: '-tzf', descKey: 'shellSuggest.flag.tar.tzf' },
    { flag: '-xvf', descKey: 'shellSuggest.flag.tar.xvf' },
  ],
  systemctl: [
    { flag: 'status', descKey: 'shellSuggest.flag.systemctl.status' },
    { flag: 'start', descKey: 'shellSuggest.flag.systemctl.start' },
    { flag: 'stop', descKey: 'shellSuggest.flag.systemctl.stop' },
    { flag: 'restart', descKey: 'shellSuggest.flag.systemctl.restart' },
    { flag: 'enable', descKey: 'shellSuggest.flag.systemctl.enable' },
    { flag: 'disable', descKey: 'shellSuggest.flag.systemctl.disable' },
    { flag: 'list-units', descKey: 'shellSuggest.flag.systemctl.listUnits' },
  ],
  journalctl: [
    { flag: '-u', descKey: 'shellSuggest.flag.journalctl.u' },
    { flag: '-f', descKey: 'shellSuggest.flag.journalctl.f' },
    { flag: '-n', descKey: 'shellSuggest.flag.journalctl.n' },
    { flag: '-xe', descKey: 'shellSuggest.flag.journalctl.xe' },
  ],
  docker: [
    { flag: 'ps', descKey: 'shellSuggest.flag.docker.ps' },
    { flag: 'ps -a', descKey: 'shellSuggest.flag.docker.psA' },
    { flag: 'images', descKey: 'shellSuggest.flag.docker.images' },
    { flag: 'logs', descKey: 'shellSuggest.flag.docker.logs' },
    { flag: 'exec -it', descKey: 'shellSuggest.flag.docker.exec' },
    { flag: 'start', descKey: 'shellSuggest.flag.docker.start' },
    { flag: 'stop', descKey: 'shellSuggest.flag.docker.stop' },
    { flag: 'restart', descKey: 'shellSuggest.flag.docker.restart' },
    { flag: 'rm', descKey: 'shellSuggest.flag.docker.rm' },
    { flag: 'rmi', descKey: 'shellSuggest.flag.docker.rmi' },
  ],
  ss: [
    { flag: '-lntp', descKey: 'shellSuggest.flag.ss.lntp' },
    { flag: '-tulpn', descKey: 'shellSuggest.flag.ss.tulpn' },
    { flag: '-s', descKey: 'shellSuggest.flag.ss.s' },
  ],
  ip: [
    { flag: 'a', descKey: 'shellSuggest.flag.ip.a' },
    { flag: 'r', descKey: 'shellSuggest.flag.ip.r' },
    { flag: 'link', descKey: 'shellSuggest.flag.ip.link' },
    { flag: 'addr', descKey: 'shellSuggest.flag.ip.addr' },
  ],
  kill: [
    { flag: '-9', descKey: 'shellSuggest.flag.kill.nine' },
    { flag: '-15', descKey: 'shellSuggest.flag.kill.fifteen' },
    { flag: '-l', descKey: 'shellSuggest.flag.kill.l' },
  ],
  uname: [
    { flag: '-a', descKey: 'shellSuggest.flag.uname.a' },
    { flag: '-r', descKey: 'shellSuggest.flag.uname.r' },
    { flag: '-m', descKey: 'shellSuggest.flag.uname.m' },
  ],
  curl: [
    { flag: '-I', descKey: 'shellSuggest.flag.curl.I' },
    { flag: '-L', descKey: 'shellSuggest.flag.curl.L' },
    { flag: '-O', descKey: 'shellSuggest.flag.curl.O' },
    { flag: '-v', descKey: 'shellSuggest.flag.curl.v' },
    { flag: '-X', descKey: 'shellSuggest.flag.curl.X' },
  ],
  git: [
    { flag: 'status', descKey: 'shellSuggest.flag.git.status' },
    { flag: 'log', descKey: 'shellSuggest.flag.git.log' },
    { flag: 'diff', descKey: 'shellSuggest.flag.git.diff' },
    { flag: 'pull', descKey: 'shellSuggest.flag.git.pull' },
    { flag: 'push', descKey: 'shellSuggest.flag.git.push' },
    { flag: 'clone', descKey: 'shellSuggest.flag.git.clone' },
    { flag: 'commit', descKey: 'shellSuggest.flag.git.commit' },
    { flag: 'checkout', descKey: 'shellSuggest.flag.git.checkout' },
    { flag: 'branch', descKey: 'shellSuggest.flag.git.branch' },
  ],
  cat: [
    { flag: '-n', descKey: 'shellSuggest.flag.cat.n' },
    { flag: '-A', descKey: 'shellSuggest.flag.cat.A' },
  ],
  sort: [
    { flag: '-n', descKey: 'shellSuggest.flag.sort.n' },
    { flag: '-r', descKey: 'shellSuggest.flag.sort.r' },
    { flag: '-u', descKey: 'shellSuggest.flag.sort.u' },
    { flag: '-k', descKey: 'shellSuggest.flag.sort.k' },
  ],
  wget: [
    { flag: '-c', descKey: 'shellSuggest.flag.wget.c' },
    { flag: '-O', descKey: 'shellSuggest.flag.wget.O' },
    { flag: '-q', descKey: 'shellSuggest.flag.wget.q' },
  ],
}

export function getFlagsForCommand(cmd: string): ShellFlagItem[] {
  return SHELL_COMMAND_FLAGS[cmd.toLowerCase()] || []
}
