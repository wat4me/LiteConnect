// Real portable X server + SSH2 transport smoke. No saved connections, credentials
// or system X server settings are read. All started processes belong to this run.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import ssh2 from 'ssh2'
import { prepareX11Runtime } from './prepare-x11-runtime.mjs'

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagedExecutable = process.env.LITECONNECT_X11_SMOKE_EXECUTABLE
if (!packagedExecutable) prepareX11Runtime()
const cache = join(root, 'node_modules/.cache/litessh/x11-smoke')
await mkdir(cache, { recursive: true })
const bundle = join(cache, 'runtime.mjs')
await build({ stdin: { contents: `
  export { ConnectionService } from './electron/ssh/connectionService';
  export { configureX11ServerOptions } from './electron/ssh/x11/x11Server';
  export { managedX11Server } from './electron/ssh/x11/managedX11';
  export { buildAuthenticatedSetup, buildXauthority, probeAuthenticatedX11 } from './electron/ssh/x11/x11Auth';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle })
const { ConnectionService, managedX11Server, buildAuthenticatedSetup, buildXauthority, probeAuthenticatedX11, configureX11ServerOptions } = await import(pathToFileURL(bundle))
if (packagedExecutable) configureX11ServerOptions({ executablePath: resolve(packagedExecutable) })
const artifacts = await mkdtemp(join(tmpdir(), 'liteconnect-x11-smoke-'))
let action = 'starting fixture'
const step = label => { action = label; console.log(`[X11 smoke] ${label}`) }
const deadline = setTimeout(() => { console.error('X11 smoke timed out', { artifacts, action }); void cleanup().finally(() => process.exit(1)) }, 60_000)
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port) })
})
const sessions = new Map()
const sockets = new Set()
const serverClients = new Set()
const x11Requests = []
const notices = []
const checks = []
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
const server = new ssh2.Server({ hostKeys: [hostKey] }, remote => {
  serverClients.add(remote)
  remote.on('error', () => {})
  let deny = false
  remote.on('authentication', ctx => { deny = ctx.username === 'reject-x11'; ctx.accept() })
  remote.on('ready', () => remote.on('session', accept => {
    const session = accept()
    session.on('pty', accept => accept())
    session.on('x11', (accept, reject, info) => {
      x11Requests.push({ remote, info })
      if (deny) reject(); else accept()
    })
    session.on('shell', accept => { const shell = accept(); shell.write('test shell ready\r\n') })
  }))
})
const epochs = new Map()
const service = new ConnectionService({
  sessions, decoders: new Map(), pendingHostKeys: new Map(),
  // The fixture's ephemeral host key is trusted only inside this process.
  knownHosts: { verifySync: () => ({ accepted: true }) },
  cleanupSession: id => {
    const session = sessions.get(id)
    if (session) { for (const socket of session.x11Sockets ?? []) socket.destroy(); session.stream.close(); session.client.end() }
    sessions.delete(id)
  },
  bumpSessionEpoch: id => { const value = (epochs.get(id) ?? 0) + 1; epochs.set(id, value); return value },
  getSessionEpoch: id => epochs.get(id),
})
const callbacks = { onData: (_id, text) => notices.push(text), onError: (_id, error) => { throw new Error(error) }, onClose() {} }
let clock
let proxy
let blocker
let target
async function cleanup() {
  clearTimeout(deadline)
  clock?.kill()
  for (const session of sessions.values()) { session.client.on('error', () => {}); session.client.destroy() }
  for (const client of serverClients) client.end()
  for (const socket of sockets) socket.destroy()
  proxy?.close()
  blocker?.close()
  server.close()
  await managedX11Server.stop()
  await Promise.all(['local-Xauthority', 'remote-Xauthority'].map(name => rm(join(artifacts, name), { force: true })))
}
try {
  // Deliberately occupy the first automatic display, without touching :0.
  blocker = createServer(socket => { sockets.add(socket); socket.on('error', () => {}) })
  await new Promise(resolve => { blocker.once('error', resolve); blocker.listen(6050, '127.0.0.1', resolve) })
  const sshPort = await listen(server)
  step('connecting automatic SSH terminal')
  const profile = { id: 'fixture', name: 'X11 fixture', host: '127.0.0.1', port: sshPort, username: 'fixture', password: '', x11Forwarding: false }
  const id = await service.connect(profile, callbacks)
  step('SSH terminal connected')
  assert.equal(x11Requests.length, 1, notices.join(''))
  target = await managedX11Server.ensure()
  if (packagedExecutable) assert.equal(target.executablePath, resolve(packagedExecutable))
  assert.notEqual(target.display, 50)
  const request = x11Requests[0]
  // ssh2 currently returns this hex field as a Buffer despite its README type.
  const cookie = Buffer.from(String(request.info.cookie), 'hex')
  assert.notDeepEqual(cookie, target.localCookie)
  assert.equal(request.info.protocol, 'MIT-MAGIC-COOKIE-1')
  const channel = await new Promise((resolve, reject) => request.remote.x11('127.0.0.1', 12345, (error, stream) => error ? reject(error) : resolve(stream)))
  step('checking authenticated X11 channel')
  channel.on('error', () => {})
  const reply = Promise.race([once(channel, 'data'), once(channel, 'close').then(() => { throw new Error('X11 channel closed before setup reply') })])
  const setup = buildAuthenticatedSetup(cookie)
  channel.write(setup.subarray(0, 7))
  channel.write(setup.subarray(7))
  assert.equal((await reply)[0][0], 1)
  channel.close()
  checks.push('legacy connection automatically requested X11; real SSH channel authenticated with rewritten session cookie')
  step('SSH X11 handshake passed')
  assert.equal(await probeAuthenticatedX11(target.host, 6000 + target.display, randomBytes(16)), false)
  checks.push('incorrect local cookie rejected')

  proxy = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    request.remote.x11('127.0.0.1', socket.remotePort, (error, stream) => {
      if (error) { socket.destroy(); return }
      stream.on('error', () => socket.destroy())
      stream.on('close', () => socket.destroy())
      socket.on('close', () => stream.close())
      socket.pipe(stream).pipe(socket)
    })
  })
  const proxyPort = await listen(proxy)
  const remoteAuthority = join(artifacts, 'remote-Xauthority')
  const localAuthority = join(artifacts, 'local-Xauthority')
  await writeFile(remoteAuthority, buildXauthority(proxyPort - 6000, cookie))
  await writeFile(localAuthority, buildXauthority(target.display, target.localCookie))
  const runtime = dirname(target.executablePath)
  clock = spawn(join(runtime, 'xclock.exe'), ['-display', `127.0.0.1:${proxyPort - 6000}`, '-title', 'LiteConnect X11 smoke', '-geometry', '120x120+40+40'], {
    cwd: runtime, env: { ...process.env, XAUTHORITY: remoteAuthority }, windowsHide: true, stdio: 'ignore',
  })
  clock.on('error', () => {})
  step('checking native graphical window')
  let tree = ''
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    const result = await promisify(execFile)(join(runtime, 'xwininfo.exe'), ['-display', `127.0.0.1:${target.display}`, '-root', '-tree'], {
      cwd: runtime, env: { ...process.env, XAUTHORITY: localAuthority }, windowsHide: true, timeout: 3000,
    })
    tree = result.stdout
    if (tree.includes('LiteConnect X11 smoke')) break
  }
  assert.ok(tree.includes('LiteConnect X11 smoke'), 'graphical window must exist on the real Windows X server')
  await writeFile(join(artifacts, 'window-tree.txt'), tree)
  clock.kill()
  await once(clock, 'exit')
  clock = undefined
  checks.push('native xclock window opened through the real SSH X11 tunnel')

  await service.reconnect(id, profile, callbacks)
  assert.notEqual(x11Requests[1].info.cookie, request.info.cookie)
  checks.push('reconnect issued a fresh session cookie')
  const before = x11Requests.length
  await service.connect({ ...profile, id: 'off', x11Mode: 'off' }, callbacks)
  assert.equal(x11Requests.length, before)
  checks.push('explicit per-connection opt-out opened an ordinary shell')
  await service.connect({ ...profile, id: 'denied', username: 'reject-x11' }, callbacks)
  assert.ok(notices.some(text => text.includes('拒绝 X11') || text.includes('rejected X11')))
  checks.push('remote X11 rejection fell back to a working ordinary shell')
  await managedX11Server.stop()
  assert.equal(await probeAuthenticatedX11(target.host, 6000 + target.display, target.localCookie), false)
  if (blocker.listening) assert.equal(blocker.address().port, 6050)
  checks.push('shutdown stopped only managed displays and preserved the occupied display')
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(JSON.stringify({ passed: true, checks, artifacts }, null, 2))
} finally {
  await cleanup()
}
