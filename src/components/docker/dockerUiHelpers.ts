import type { DockerContainerAction } from '../../env.d'
import { visibleContainerActions } from '../../composables/docker/dockerContainerActions'

export function actionsForState(state: string): DockerContainerAction[] {
  return visibleContainerActions(state)
}

export function primaryRowActions(state: string): DockerContainerAction[] {
  return visibleContainerActions(state).filter((a) => a === 'start' || a === 'stop')
}

export function stateTone(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running') return 'ok'
  if (s === 'paused' || s === 'restarting') return 'warn'
  if (s === 'exited' || s === 'dead' || s === 'created' || s === 'removing') return 'muted'
  return 'muted'
}

export function formatCreated(ts: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts * 1000).toLocaleString()
  } catch {
    return String(ts)
  }
}

export function formatInspectTime(raw: string | null | undefined): string {
  if (raw == null) return '—'
  const s = String(raw).trim()
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function formatPortChip(p: {
  ip: string
  privatePort: number
  publicPort: number | null
  type: string
}): string {
  if (p.publicPort != null) {
    const host = p.ip && p.ip !== '0.0.0.0' && p.ip !== '::' ? `${p.ip}:` : ''
    return `${host}${p.publicPort}→${p.privatePort}/${p.type}`
  }
  return `${p.privatePort}/${p.type}`
}

/** Resolve labels at call time so changing locale updates existing views. */
export function createDockerLabels(t: (key: string) => string) {
  function stateLabel(state: string): string {
    const s = (state || '').toLowerCase()
    if (s === 'running') return t('docker.containerState.running')
    if (s === 'exited') return t('docker.containerState.exited')
    if (s === 'created') return t('docker.containerState.created')
    if (s === 'dead') return t('docker.containerState.dead')
    if (s === 'paused') return t('docker.containerState.paused')
    if (s === 'restarting') return t('docker.containerState.restarting')
    if (s === 'removing') return t('docker.containerState.removing')
    return state || t('docker.containerState.unknown')
  }

  function actionLabel(action: DockerContainerAction): string {
    if (action === 'start') return t('docker.actions.start')
    if (action === 'stop') return t('docker.actions.stop')
    return t('docker.actions.restart')
  }

  function actionBusyLabel(action: DockerContainerAction): string {
    if (action === 'start') return t('docker.actions.starting')
    if (action === 'stop') return t('docker.actions.stopping')
    return t('docker.actions.restarting')
  }

  function actionAria(action: DockerContainerAction): string {
    if (action === 'start') return t('docker.actions.startAria')
    if (action === 'stop') return t('docker.actions.stopAria')
    return t('docker.actions.restartAria')
  }

  return { stateLabel, actionLabel, actionBusyLabel, actionAria }
}
