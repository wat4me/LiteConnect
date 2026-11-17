import { createApp } from 'vue'
import i18n from '../../src/i18n'
import type { ApprovalMode, McpHttpStatus } from '../../shared/mcp/types'
import { buildMcpClientSnippets, mcpHttpUrl } from '../../electron/mcp/clientConfig'
import Fixture from './NavigationFixture.vue'
import '../../src/styles/main.css'

let port = 18765
let approvalMode: ApprovalMode = 'deny-destructive'
function mcpStatus(): McpHttpStatus {
  const url = mcpHttpUrl(port)
  const token = 'fixture-token'
  return {
    enabled: true,
    listening: true,
    host: '127.0.0.1',
    port,
    url,
    token,
    lastError: null,
    snippets: buildMcpClientSnippets(url, token),
    approvalMode,
  }
}

Object.assign(window, {
  LiteConnect: {
    mcpGetHttpStatus: async () => mcpStatus(),
    mcpSetHttpPort: async (nextPort: number) => {
      port = nextPort
      return mcpStatus()
    },
    mcpSetApprovalMode: async (mode: ApprovalMode) => {
      approvalMode = mode
      return mcpStatus()
    },
  },
})

const app = createApp(Fixture).use(i18n)
app.config.errorHandler = error => { (window as any).__navigationError = String(error) }
app.mount('#app')
