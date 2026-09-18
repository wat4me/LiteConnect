import {
  DockerTransportError,
  type DockerAvailability,
  type DockerInstallationPresence,
  type DockerTransportErrorCode,
} from './types'

/** Stable user-facing messages (status is the contract; do not parse these in UI logic). */
export const DOCKER_AVAILABILITY_MESSAGES = {
  'daemon-unavailable':
    '无法确认 Docker 守护进程是否可用：通过 SSH 访问 /var/run/docker.sock 失败，或守护进程未响应。可在服务器上执行 docker info 与 curl --unix-socket /var/run/docker.sock http://localhost/_ping 对照。',
  'permission-denied':
    '当前 SSH 用户无权访问 /var/run/docker.sock。请将用户加入 docker 组，或使用有权限的账号（Socket 权限近似 root）。',
  'transport-unsupported':
    'SSH 服务器不支持 Unix Socket 转发（StreamLocal / direct-streamlocal）。请检查 OpenSSH 版本与 AllowStreamLocalForwarding 等配置。',
  'socket-forward-failed':
    'SSH 已连接，但无法通过 StreamLocal 打开 /var/run/docker.sock（常见于 SELinux 拦截 sshd 访问 Docker Socket，或 sshd 策略限制）。服务器本机 docker info 可能仍正常。可临时 setenforce 0 验证，或检查 audit 日志与 sshd StreamLocal 配置。',
  'request-timeout':
    'Docker 检测超时：经 SSH 转发访问 Docker API 未在时限内响应。请确认网络与远端 Docker 状态后刷新。',
  'request-failed':
    'Docker 检测请求失败：经 SSH 转发调用 Docker API 出错。请确认 SSH 仍连接后刷新重试。',
} as const

/**
 * Map transport/request errors to DockerAvailability.
 *
 * socket-not-found is NOT mapped to not-installed here: missing /var/run/docker.sock
 * is also normal when Docker is installed but the daemon is stopped. Callers must
 * resolve socket-not-found via resolveSocketNotFound(presence).
 */
export function mapTransportErrorToAvailability(err: unknown): DockerAvailability {
  if (err instanceof DockerTransportError) {
    return mapCodeToAvailability(err.code)
  }
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : ''
  if (code === 'ssh-disconnected') return { status: 'ssh-disconnected' }
  if (code === 'transport-unsupported') {
    return {
      status: 'transport-unsupported',
      message: DOCKER_AVAILABILITY_MESSAGES['transport-unsupported'],
    }
  }
  if (code === 'permission-denied') {
    return {
      status: 'permission-denied',
      message: DOCKER_AVAILABILITY_MESSAGES['permission-denied'],
    }
  }
  if (code === 'socket-forward-failed') {
    return {
      status: 'socket-forward-failed',
      message: DOCKER_AVAILABILITY_MESSAGES['socket-forward-failed'],
    }
  }
  // socket-not-found and everything else → conservative daemon-unavailable
  // (service layer overrides socket-not-found after installation check)
  return {
    status: 'daemon-unavailable',
    message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
  }
}

export function mapCodeToAvailability(code: DockerTransportErrorCode): DockerAvailability {
  switch (code) {
    case 'ssh-disconnected':
    case 'generation-stale':
      return { status: 'ssh-disconnected' }
    case 'transport-unsupported':
      return {
        status: 'transport-unsupported',
        message: DOCKER_AVAILABILITY_MESSAGES['transport-unsupported'],
      }
    case 'socket-forward-failed':
      return {
        status: 'socket-forward-failed',
        message: DOCKER_AVAILABILITY_MESSAGES['socket-forward-failed'],
      }
    case 'permission-denied':
      return {
        status: 'permission-denied',
        message: DOCKER_AVAILABILITY_MESSAGES['permission-denied'],
      }
    case 'socket-not-found':
      // Conservative default without install evidence — service resolves via install check
      return {
        status: 'daemon-unavailable',
        message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
      }
    case 'request-timeout':
      return {
        status: 'daemon-unavailable',
        message: DOCKER_AVAILABILITY_MESSAGES['request-timeout'],
      }
    case 'request-failed':
      return {
        status: 'daemon-unavailable',
        message: DOCKER_AVAILABILITY_MESSAGES['request-failed'],
      }
    case 'daemon-unavailable':
    case 'proxy-closed':
    default:
      return {
        status: 'daemon-unavailable',
        message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
      }
  }
}

/**
 * Resolve socket-not-found using installation presence evidence.
 * - not-installed only when check confirmed binaries absent
 * - installed → daemon-unavailable (engine present, socket/daemon not up)
 * - unknown / check failure → daemon-unavailable (never false not-installed)
 */
export function resolveSocketNotFound(
  presence: DockerInstallationPresence,
): DockerAvailability {
  if (presence === 'not-installed') {
    return { status: 'not-installed' }
  }
  return {
    status: 'daemon-unavailable',
    message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
  }
}
