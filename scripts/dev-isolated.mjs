import { spawn } from 'child_process'
import { resolve } from 'path'

const dataDirectory = resolve(
  process.env.LITECONNECT_DEV_USER_DATA_DIR || '.liteconnect-dev-data',
)
const npmCli = process.env.npm_execpath

if (!npmCli) {
  throw new Error('npm_execpath is unavailable; run this command through npm run dev:isolated')
}

console.info(`[dev:isolated] LiteConnect data directory: ${dataDirectory}`)

const child = spawn(process.execPath, [npmCli, 'run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LITECONNECT_DEV_USER_DATA_DIR: dataDirectory,
  },
})

child.on('error', (error) => {
  console.error('[dev:isolated] Failed to start:', error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[dev:isolated] Child process exited after signal ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
