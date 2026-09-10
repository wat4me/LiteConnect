import { beforeAll, describe, expect, it } from 'vitest'
import { assessAiToolCall, type AiDeclaredRisk, type AiToolPermissionMode } from '../../shared/aiToolPolicy'
import { initBashAst } from '../mcp/bashParser'
import { applyCommandFloor, commandContentRisk } from './commandFloor'

const classOf = (tool: string, args: unknown) => commandContentRisk(tool, args)?.class ?? null

/** The production path: declaration gate first, then the escalate-only floor. */
function gateFor(command: string, risk: AiDeclaredRisk, mode: AiToolPermissionMode) {
  const args = { command, risk, explanation: '执行该命令' }
  return applyCommandFloor(
    assessAiToolCall('exec', args, mode),
    commandContentRisk('exec', args),
    mode,
  )
}

beforeAll(async () => {
  const status = await initBashAst()
  expect(status.ok, status.ok ? '' : status.reason).toBe(true)
})

describe('commandContentRisk', () => {
  it('rates exec commands independently of any declaration', () => {
    expect(classOf('exec', { command: 'ls -la /var/log' })).toBe('read-only')
    expect(classOf('exec', { command: 'mkdir -p /tmp/a' })).toBe('safe')
    expect(classOf('exec', { command: 'rm -rf /tmp/a' })).toBe('destructive')
    expect(classOf('exec', { command: 'sudo rm -rf /tmp/a' })).toBe('privileged')
    expect(classOf('exec', { command: 'rm -rf /' })).toBe('forbidden')
  })

  it('sees through the indirection that let a labelled read delete things', () => {
    expect(classOf('exec', { command: 'cat $(rm -rf ~)' })).not.toBe('read-only')
    expect(classOf('exec', { command: `bash -c "rm -rf /etc"` })).not.toBe('read-only')
    expect(classOf('exec', { command: 'ls | xargs rm' })).not.toBe('read-only')
    expect(classOf('exec', { command: `python3 -c "import shutil; shutil.rmtree('/')"` })).not.toBe('read-only')
  })

  it('rates service_control by action', () => {
    expect(classOf('service_control', { action: 'status' })).toBe('read-only')
    expect(classOf('service_control', { action: 'restart' })).toBe('destructive')
    expect(classOf('service_control', {})).toBe('read-only')
  })

  it('ignores tools that run no command', () => {
    expect(commandContentRisk('read_file', { path: '/etc/passwd' })).toBeNull()
    expect(commandContentRisk('grep', { pattern: 'rm -rf' })).toBeNull()
    expect(commandContentRisk('exec', {})).toBeNull()
  })
})

describe('applyCommandFloor', () => {
  it('leaves an honest declaration alone', () => {
    expect(gateFor('ls -la', 'read', 'ask').action).toBe('allow')
    expect(gateFor('mkdir /tmp/a', 'write', 'ask').action).toBe('ask')
    expect(gateFor('rm -rf /tmp/a', 'write', 'auto').action).toBe('allow')
  })

  it('escalates instead of waiving when the declaration is understated', () => {
    const gate = gateFor('rm -rf /tmp/a', 'read', 'auto')
    expect(gate.action).toBe('ask')
    expect(gate.reason).toContain('高于申报')

    expect(gateFor('mkdir /tmp/a', 'read', 'auto').action).toBe('ask')
    expect(gateFor('crontab -l', 'read', 'auto').action).toBe('allow')
  })

  it('never auto-approves a forbidden command, however it was declared', () => {
    expect(gateFor('rm -rf /', 'read', 'auto').action).toBe('ask')
    expect(gateFor('rm -rf /', 'write', 'auto').action).toBe('ask')
    expect(gateFor('rm -rf /', 'privileged', 'auto').action).toBe('ask')
    expect(gateFor('rm -rf /', 'privileged', 'ask').action).toBe('ask')
  })

  it('blocks a non-read command in readonly mode rather than asking', () => {
    const gate = gateFor('rm -rf /tmp/a', 'read', 'readonly')
    expect(gate).toMatchObject({ action: 'deny', code: 'READONLY_MODE' })
    expect(gateFor('ls -la', 'read', 'readonly').action).toBe('allow')
  })

  it('escalates a privileged floor onto an unprivileged declaration', () => {
    expect(gateFor('sudo ls', 'write', 'auto').action).toBe('ask')
    expect(gateFor('sudo ls', 'privileged', 'auto').action).toBe('allow')
  })

  it('keeps malformed declarations in the reclassify path', () => {
    const gate = applyCommandFloor(
      assessAiToolCall('exec', { command: 'rm -rf /' }, 'auto'),
      commandContentRisk('exec', { command: 'rm -rf /' }),
      'auto',
    )
    expect(gate).toMatchObject({ action: 'reclassify', code: 'RISK_REQUIRED' })
  })

  it('passes the gate through untouched when there is no command to rate', () => {
    const gate = assessAiToolCall('read_file', { path: '/tmp/a', risk: 'read', explanation: 'x' }, 'ask')
    expect(applyCommandFloor(gate, null, 'ask')).toBe(gate)
  })
})

/**
 * The card has to stay credible. Blaming the model for a command the classifier
 * merely failed to recognise trains the user to click through the one warning
 * that matters, so the two cases must read differently.
 */
describe('approval wording', () => {
  it('lets a version probe through without a card at all', () => {
    const probe = '/root/nginx128/sbin/nginx -v 2>&1 | head -5; echo "=== files ==="; ls -l /root/nginx128/conf/'
    expect(commandContentRisk('exec', { command: probe })?.class).toBe('read-only')
    expect(gateFor(probe, 'read', 'ask').action).toBe('allow')
  })

  it('says it could not verify, not that the model lied', () => {
    const gate = gateFor('/usr/sbin/nginx -t', 'read', 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.reason).toContain('无法核实')
    expect(gate.reason).toContain('nginx')
    expect(gate.reason).not.toContain('高于申报')
  })

  it('names an inline script rather than an unknown program', () => {
    const gate = gateFor(`python3 -c "import shutil; shutil.rmtree('/')"`, 'read', 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.reason).toContain('无法预先核实')
    expect(gate.reason).not.toContain('高于申报')
  })

  it('still calls out a genuine under-declaration', () => {
    const gate = gateFor('systemctl stop nginx', 'read', 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.reason).toContain('高于申报')
    expect(gate.reason).not.toContain('无法核实')
  })

  it('explains a readonly-mode denial without blaming the model either', () => {
    const gate = gateFor('mystery-daemon --reindex', 'read', 'readonly')
    expect(gate).toMatchObject({ action: 'deny', code: 'READONLY_MODE' })
    expect(gate.reason).toContain('无法核实')
  })
})
