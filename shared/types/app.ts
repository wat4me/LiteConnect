export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'cancelled' | 'error'
  version?: string
  progress?: number
  message?: string
}
