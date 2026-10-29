const { prepareMacSigning } = require('./macos-signing.cjs')
const { verifyMacArtifacts } = require('./verify-macos-release.cjs')

async function main() {
  if (process.platform !== 'darwin') throw new Error('Package macOS releases on a macOS host.')
  const plan = prepareMacSigning()
  try {
    Object.assign(process.env, plan.environment)
    if (plan.signed) {
      // Use one unambiguous notarization method; v25 otherwise prioritizes APPLE_ID.
      delete process.env.APPLE_ID
      delete process.env.APPLE_APP_SPECIFIC_PASSWORD
      console.log('[macOS] Developer ID signing and Apple notarization are required for this build.')
    } else console.warn('[macOS] UNSIGNED build: first launch may be blocked by Gatekeeper. Configure MACOS_SIGNING_ENABLED and credentials for notarized distribution.')
    const builder = require('electron-builder')
    const artifacts = await builder.build({ targets: builder.Platform.MAC.createTarget(), config: plan.config, publish: 'never' })
    if (plan.signed) verifyMacArtifacts(artifacts, process.env.APPLE_TEAM_ID)
  } finally { plan.cleanup() }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
