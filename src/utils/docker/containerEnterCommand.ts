import { splitCommandSegments, tokenizeShellWords } from '@/utils/terminal/shellText'


/** Drop leading env assignments and sudo/doas. */
function stripLeadWrappers(tokens: string[]): string[] {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.includes('=') && !t.startsWith('-') && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i++
      continue
    }
    if (t === 'sudo' || t === 'doas') {
      i++
      // skip common sudo flags: -u user, -E, -i, ...
      while (i < tokens.length && tokens[i].startsWith('-')) {
        const flag = tokens[i]
        i++
        // flags that take a value
        if (
          /^-u$|^--user$|^-g$|^--group$|^-p$|^--prompt$|^-C$|^--close-from$/.test(flag) &&
          i < tokens.length
        ) {
          i++
        }
      }
      continue
    }
    break
  }
  return tokens.slice(i)
}

function hasInteractiveRunFlag(tokens: string[]): boolean {
  for (const t of tokens) {
    if (t === '--interactive' || t === '--tty' || t === '-i' || t === '-t' || t === '-it' || t === '-ti') {
      return true
    }
    // bundled short flags: -itd, -dit, -i, etc.
    if (/^-[a-zA-Z]+$/.test(t) && (t.includes('i') || t.includes('t'))) {
      return true
    }
  }
  return false
}

function segmentEntersContainer(segment: string): boolean {
  const tokens = stripLeadWrappers(tokenizeShellWords(segment))
  if (tokens.length === 0) return false

  const cmd = tokens[0]
  const rest = tokens.slice(1)

  // docker / podman / nerdctl
  if (cmd === 'docker' || cmd === 'podman' || cmd === 'nerdctl') {
    const sub = rest[0]
    if (sub === 'exec' || sub === 'attach') return true
    if (sub === 'run' && hasInteractiveRunFlag(rest)) return true
    // docker compose exec …
    if (sub === 'compose' && rest[1] === 'exec') return true
    return false
  }

  if (cmd === 'docker-compose' || cmd === 'podman-compose') {
    return rest[0] === 'exec'
  }

  // kubectl exec …
  if (cmd === 'kubectl' || cmd === 'oc') {
    return rest.includes('exec')
  }

  // crictl exec
  if (cmd === 'crictl') {
    return rest[0] === 'exec'
  }

  return false
}

/** True if this submitted shell line likely enters a container / pod. */
export function isContainerEnterCommand(raw: string): boolean {
  const line = raw.trim()
  if (!line) return false
  return splitCommandSegments(line).some(segmentEntersContainer)
}
