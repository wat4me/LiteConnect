const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`macOS verification failed (${path.basename(command)}): ${result.stdout || ''}${result.stderr || ''}`)
  return `${result.stdout || ''}${result.stderr || ''}`
}

/** Check shipped artifacts, not just the intermediate .app. Does not remove quarantine. */
function verifyMacArtifacts(artifacts, teamId, { platform = process.platform, run = runChecked } = {}) {
  if (platform !== 'darwin') throw new Error('macOS artifact verification requires a macOS host.')
  const files = artifacts.filter(file => /\.(dmg|zip)$/i.test(file)).map(file => path.resolve(file))
  if (!files.some(file => /\.dmg$/i.test(file)) || !files.some(file => /\.zip$/i.test(file))) throw new Error('Signed macOS release requires both DMG and ZIP artifacts.')
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Expected Apple developer team ID is missing or invalid.')
  for (const file of files) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-macos-verify-'))
    const payload = path.join(directory, 'payload')
    let attachmentAttempted = false
    try {
      fs.mkdirSync(payload)
      if (/\.dmg$/i.test(file)) {
        // attach can mount successfully before returning an error. Always detach
        // after an attempt; if detaching fails, retain the directory untouched.
        attachmentAttempted = true
        run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', payload, file])
      } else run('/usr/bin/ditto', ['-x', '-k', file, payload])
      const appPath = path.join(payload, 'LiteConnect.app')
      if (!fs.existsSync(appPath)) throw new Error(`LiteConnect.app is missing from ${path.basename(file)}.`)
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
      const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', appPath])
      if (!signature.includes('Authority=Developer ID Application:') || !signature.split(/\r?\n/).includes(`TeamIdentifier=${teamId}`)) throw new Error(`Unexpected Developer ID signature in ${path.basename(file)}.`)
      run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
      run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath])
      console.log(`[macOS] Verified Developer ID, notarization ticket and Gatekeeper assessment: ${path.basename(file)}`)
    } finally {
      // Never recursively remove an attached volume, even if verification failed.
      if (attachmentAttempted) run('/usr/bin/hdiutil', ['detach', payload])
      const tempRoot = path.resolve(os.tmpdir())
      if (path.dirname(path.resolve(directory)) !== tempRoot || !path.basename(directory).startsWith('liteconnect-macos-verify-')) throw new Error('Refusing to clean an unexpected macOS verification directory.')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}

module.exports = { verifyMacArtifacts }
