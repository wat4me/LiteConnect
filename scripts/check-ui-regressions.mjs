import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docker = process.argv.includes('--docker')
const server = await createServer({
  configFile: false,
  root,
  plugins: [vue()],
  resolve: { alias: { '@': resolve(root, 'src'), '@shared': resolve(root, 'shared') } },
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
})

try {
  await server.listen()
  const address = server.httpServer.address()
  const env = { ...process.env, LITECONNECT_UI_TEST_URL: `http://127.0.0.1:${address.port}/scripts/ui-regression/${docker ? 'docker' : 'index'}.html` }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)('electron')
  const child = spawn(electron, [resolve(root, `scripts/ui-regression/${docker ? 'docker-runner' : 'runner'}.cjs`)], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  })
  process.exitCode = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => accept(code ?? 1))
  })
} finally {
  await server.close()
}
