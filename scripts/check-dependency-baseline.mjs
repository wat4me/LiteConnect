import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'))
const pkg = read('package.json')
const lock = read('package-lock.json')
const locked = lock.packages?.['']
const competing = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json']
  .filter(name => existsSync(join(root, name)))
const errors = []
if (competing.length) errors.push(`Use npm and package-lock.json only; remove competing locks: ${competing.join(', ')}`)
if (lock.lockfileVersion !== 3 || !locked) errors.push('Expected package-lock.json v3 with a root package entry')
if (lock.name !== pkg.name || locked?.name !== pkg.name) errors.push('Package names differ between manifest and lockfile')
if (lock.version !== pkg.version || locked?.version !== pkg.version) errors.push('Package versions differ between manifest and lockfile')
for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const entries = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
  if (entries(pkg[key]) !== entries(locked?.[key])) errors.push(`${key} differ between manifest and lockfile; update with npm install`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log('Dependency baseline passed (npm / package-lock.json).')
