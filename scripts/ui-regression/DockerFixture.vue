<script setup lang="ts">
import DockerWorkspace from '../../src/components/docker/DockerWorkspace.vue'
import type { DockerContainerLogDataEvent, DockerContainerLogStateEvent, DockerLogStreamOptionsWithRequest } from '../../shared/types/docker'

let dataListener: ((event: DockerContainerLogDataEvent) => void) | undefined
let stateListener: ((event: DockerContainerLogStateEvent) => void) | undefined
let current = { streamId: '', requestId: '' }
let sequence = 0
const calls = { starts: [] as DockerLogStreamOptionsWithRequest[], copied: [] as string[], stops: 0 }
const containers = Array.from({ length: 21 }, (_, index) => ({
  id: `fixture-${index}`, names: [`/container-${index}`],
  displayName: index === 0 ? 'v5-automation-culture-v5-9996' : `service-${index}`,
  image: 'v5-automation-baseline-data-image', imageId: 'image-fixture', command: 'java -jar app.jar',
  created: 1_700_000_000, state: index < 18 ? 'running' : 'exited', status: index < 18 ? 'Up 2 minutes' : 'Exited (0)',
  ports: [{ ip: '0.0.0.0', privatePort: 9603, publicPort: 39996, type: 'tcp' }], mounts: [],
}))

function append(count: number, long = false) {
  dataListener?.({ ...current, droppedFromMain: 0, entries: Array.from({ length: count }, () => ({
    sequence: ++sequence, stream: 'stdout' as const, timestamp: null,
    text: `09:19:02.${String(sequence).padStart(3, '0')} [main] INFO ${sequence % 5 === 0 ? 'MATCH' : 'startup'} — ${long ? 'very-long-log-line '.repeat(18) : 'Application started, 正在接收容器日志'}`,
  })) })
}

window.LiteConnect = {
  async dockerProbe() { return { status: 'available', engineVersion: '26.1.4', apiVersion: '1.45' } },
  async dockerListContainers() { return containers },
  async dockerInspectContainer(_sessionId: string, id: string) {
    const container = containers.find(c => c.id === id)!
    return { inspectJson: '{}', overview: {
      ...container, name: container.displayName, created: '2026-10-15T01:00:00Z', path: 'java', args: [],
      state: { status: container.state, running: container.state === 'running', paused: false, restarting: false, startedAt: '', finishedAt: '', exitCode: null, error: '' },
      networks: ['bridge'], restartPolicy: 'always',
    } }
  },
  onDockerContainerLogData(listener: typeof dataListener) { dataListener = listener; return () => { dataListener = undefined } },
  onDockerContainerLogState(listener: typeof stateListener) { stateListener = listener; return () => { stateListener = undefined } },
  async dockerStartContainerLogs(_sessionId: string, _containerId: string, options: DockerLogStreamOptionsWithRequest) {
    calls.starts.push(options)
    current = { streamId: `stream-${calls.starts.length}`, requestId: options.requestId }
    queueMicrotask(() => {
      append(options.tail)
      stateListener?.({ ...current, state: options.follow ? 'streaming' : 'ended' })
    })
    return { ok: true, ...current }
  },
  async dockerStopContainerLogs() { calls.stops++; return { ok: true } },
  async clipboardWriteText(text: string) { calls.copied.push(text) },
} as unknown as typeof window.LiteConnect

;(window as any).__dockerUi = { append, calls }
</script>

<template>
  <div class="docker-fixture"><DockerWorkspace session-id="fixture-session" /></div>
</template>

<style scoped>
.docker-fixture { height: 100%; display: flex; }
:global(body), :global(*) { transition: none !important; }
</style>
