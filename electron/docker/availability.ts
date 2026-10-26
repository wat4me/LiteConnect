import { t } from '../i18n'
import {
  DockerTransportError,
  type DockerAvailability,
  type DockerInstallationPresence,
  type DockerTransportErrorCode,
} from './types'

/** User-facing messages resolved at read time (status is the contract; do not parse these in UI logic). */
export const DOCKER_AVAILABILITY_MESSAGES = {
  get 'daemon-unavailable'() { return t('notice.dockerDaemonUnavailable') },
  get 'permission-denied'() { return t('notice.dockerPermissionDenied') },
  get 'transport-unsupported'() { return t('notice.dockerTransportUnsupported') },
  get 'socket-forward-failed'() { return t('notice.dockerSocketForwardFailed') },
  get 'request-timeout'() { return t('notice.dockerRequestTimeout') },
  get 'request-failed'() { return t('notice.dockerRequestFailed') },
}

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
