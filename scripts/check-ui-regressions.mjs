import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const x11 = process.argv.includes('--x11')
const docker = process.argv.includes('--docker')
const questionsIntegrated = process.argv.includes('--questions-integrated')
const questions = process.argv.includes('--questions') || questionsIntegrated
const markdown = process.argv.includes('--markdown')
const markdownStress = process.argv.includes('--markdown-stress')
const chatHistory = process.argv.includes('--chat-history')
const aiRetention = process.argv.includes('--ai-retention')
const workspaceDisconnect = process.argv.includes('--workspace-disconnect')
const workspacePending = process.argv.includes('--workspace-pending')
const aiTransfers = process.argv.includes('--ai-transfers')
const backgroundTiming = process.argv.includes('--background-timing')
const groupsOnly = process.argv.includes('--groups')
const executionHistory = process.argv.includes('--execution-history')
const drag = process.argv.includes('--drag')
const connectionsLayout = process.argv.includes('--connections-layout')
const performance = process.argv.includes('--performance') || drag || connectionsLayout
const largeViews = process.argv.includes('--large-views')
const server = await createServer({
  configFile: false,
  root,
  cacheDir: mkdtempSync(resolve(tmpdir(), 'liteconnect-ui-vite-')),
  plugins: [vue()],
  resolve: { alias: { '@': resolve(root, 'src'), '@shared': resolve(root, 'shared') } },
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
})

try {
  await server.listen()
  const address = server.httpServer.address()
  const env = { ...process.env, LITECONNECT_UI_TEST_URL: `http://127.0.0.1:${address.port}/scripts/ui-regression/${x11 ? 'x11' : docker ? 'docker' : largeViews ? 'large-views' : performance ? 'performance' : 'index'}.html`, LITECONNECT_UI_QUESTIONS_INTEGRATED: questionsIntegrated ? '1' : '', LITECONNECT_UI_GROUPS_ONLY: groupsOnly ? '1' : '' }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)('electron')
  const child = spawn(electron, [resolve(root, `scripts/ui-regression/${x11 ? 'x11-runner' : docker ? 'docker-runner' : largeViews ? 'large-views-runner' : drag ? 'connection-drag-runner' : connectionsLayout ? 'connections-layout-runner' : performance ? 'performance-runner' : executionHistory ? 'execution-history-runner' : questions ? 'questions-runner' : aiTransfers ? 'ai-transfers-runner' : workspacePending ? 'workspace-pending-runner' : workspaceDisconnect ? 'workspace-disconnect-runner' : aiRetention ? 'ai-retention-runner' : chatHistory ? 'chat-history-runner' : markdownStress ? 'markdown-stress-runner' : markdown ? 'markdown-runner' : backgroundTiming ? 'background-timing-runner' : 'runner'}.cjs`)], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  })
  process.exitCode = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => accept(code ?? 1))
  })
} finally {
  await server.close()
}
