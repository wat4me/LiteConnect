export type TimedChatMessage = {
  role: 'user' | 'assistant'
  createdAt: number
  completedAt?: number
  streaming?: boolean
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** User messages use send time; assistant messages appear only after completion. */
export function messageDisplayTimestamp(message: TimedChatMessage): number | undefined {
  if (message.role === 'user') return validTimestamp(message.createdAt) ? message.createdAt : undefined
  if (message.streaming) return undefined
  if (validTimestamp(message.completedAt)) return message.completedAt
  return validTimestamp(message.createdAt) ? message.createdAt : undefined
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatMessageTimeDetail(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatMessageTime(timestamp)}:${pad(date.getSeconds())}`
}
