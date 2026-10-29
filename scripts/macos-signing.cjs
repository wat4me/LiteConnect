const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const credentials = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']

/** Explicit opt-in: incomplete credentials must never silently produce an unsigned release. */
function prepareMacSigning(env = process.env, projectDir = process.cwd()) {
  const mode = (env.MACOS_SIGNING_ENABLED || '').trim().toLowerCase()
  if (!['', 'false', 'true'].includes(mode)) throw new Error('MACOS_SIGNING_ENABLED must be true or false.')
  const signed = mode === 'true'
  const config = { extends: path.resolve(projectDir, 'electron-builder.yml'), mac: { identity: null, hardenedRuntime: false, notarize: false } }
  if (!signed) {
    if (credentials.some(name => env[name]?.trim())) throw new Error('macOS signing credentials are present but signing is disabled. Set MACOS_SIGNING_ENABLED=true or remove these credentials from the unsigned build.')
    return { signed, config, environment: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, cleanup() {} }
  }
  const missing = credentials.filter(name => !env[name]?.trim())
  if (missing.length) throw new Error(`Signed macOS build requires: ${missing.join(', ')}. Configure repository secrets; do not publish an unsigned fallback.`)
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('APPLE_TEAM_ID must be the 10-character Apple developer team ID.')
  const encoded = env.APPLE_API_KEY_BASE64.replace(/\s/g, '')
  if (encoded.length > 64 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('APPLE_API_KEY_BASE64 must contain the base64-encoded App Store Connect .p8 key.')
  const key = Buffer.from(encoded, 'base64').toString('utf8')
  if (!key.includes('-----BEGIN PRIVATE KEY-----') || !key.includes('-----END PRIVATE KEY-----')) throw new Error('APPLE_API_KEY_BASE64 does not decode to an App Store Connect .p8 private key.')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liteconnect-macos-signing-'))
  const keyPath = path.join(directory, 'AuthKey.p8')
  const cleanup = () => {
    fs.rmSync(keyPath, { force: true })
    if (fs.existsSync(directory)) fs.rmdirSync(directory)
  }
  try {
    fs.chmodSync(directory, 0o700)
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' })
    return {
      signed, cleanup,
      environment: { CSC_IDENTITY_AUTO_DISCOVERY: 'true', APPLE_API_KEY: keyPath },
      config: {
        ...config, forceCodeSigning: true,
        mac: {
          // v25's flat mac options. A Team ID qualifier overrides the unsigned base config.
          identity: env.APPLE_TEAM_ID, type: 'distribution', hardenedRuntime: true, notarize: true,
          entitlements: path.resolve(projectDir, 'build/entitlements.mac.release.plist'),
          entitlementsInherit: path.resolve(projectDir, 'build/entitlements.mac.release.plist'),
          strictVerify: true, gatekeeperAssess: false,
        },
      },
    }
  } catch (error) { cleanup(); throw error }
}

module.exports = { prepareMacSigning }
