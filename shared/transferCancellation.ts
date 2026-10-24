/** Shared cancellation identity for SSH transfers, MCP adapters and IPC events. */
export class TransferCancelledError extends Error {
  constructor(message = 'Transfer cancelled') {
    super(message)
    this.name = 'TransferCancelledError'
  }
}
