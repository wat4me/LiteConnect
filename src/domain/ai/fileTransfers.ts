import type { TransferItem } from '@shared/types/sftp'

/** AI projects the shared transfer store; the view supplies the file-transfer implementation. */
export interface AiFileTransferPort {
  transfers: ReadonlyMap<string, TransferItem>
  cancelTransfer(id: string): void
  removeTransfer(id: string): void
  getSpeed(id: string): number
}
