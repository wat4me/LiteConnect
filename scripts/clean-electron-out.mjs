import { rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
rmSync(join(root, 'dist-electron'), { recursive: true, force: true })
