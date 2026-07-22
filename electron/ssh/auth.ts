import type { ConnectConfig } from 'ssh2'

export function buildAuthFields(params: {
  username: string
  password?: string
  privateKey?: string
  useAgent?: boolean
}): Partial<ConnectConfig> {
  if (params.useAgent) {
    const agent =
      process.platform === 'win32'
        ? 'pageant'
        : process.env.SSH_AUTH_SOCK || undefined
    return {
      username: params.username,
      agent,
      // Prefer agent; allow key/password as fallback if agent empty
      ...(params.privateKey
        ? {
            privateKey: Buffer.from(params.privateKey),
            ...(params.password ? { passphrase: params.password } : {}),
          }
        : params.password
          ? { password: params.password }
          : {}),
    }
  }
  if (params.privateKey) {
    return {
      username: params.username,
      privateKey: Buffer.from(params.privateKey),
      ...(params.password ? { passphrase: params.password } : {}),
    }
  }
  return {
    username: params.username,
    password: params.password || '',
  }
}
