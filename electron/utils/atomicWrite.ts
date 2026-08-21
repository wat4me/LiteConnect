import { randomBytes } from 'crypto'
import { copyFile, mkdir, rename, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

/**
 * Crash-safe write: temp file in the same directory, then rename.
 * On Windows, rename over an existing dest can fail — fall back to copy+unlink.
 */
export async function writeFileAtomic(filePath: string, contents: string | Buffer): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = join(
    dir,
    `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  )
  try {
    await writeFile(tmp, contents)
    try {
      await rename(tmp, filePath)
    } catch {
      await copyFile(tmp, filePath)
      await unlink(tmp).catch(() => {})
    }
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  space: number | undefined = 2,
): Promise<void> {
  const body = space === undefined ? JSON.stringify(data) : `${JSON.stringify(data, null, space)}\n`
  await writeFileAtomic(filePath, body)
}
