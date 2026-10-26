import type { McpLocalEnvironment } from '../../mcp/ports'
import { sharedT, type SharedTranslate } from '../../../shared/i18n'

/** Local device facts come from main, never from the model or the remote shell. */
export function localFileTransferSystemAddendum(environment: McpLocalEnvironment, translate: SharedTranslate = sharedT): string {
  return [
    translate('sharedText.promptLocalDevice'),
    translate('sharedText.promptLocalFacts'),
    JSON.stringify(environment),
    translate('sharedText.promptLocalTransfer'),
    ...(environment.platform === 'win32' ? [translate('sharedText.promptLocalWindows')] : []),
  ].join('\n')
}
