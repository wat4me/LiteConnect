<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ConnectionForm from '../../src/components/connections/ConnectionForm.vue'
import SettingsNetwork from '../../src/components/settings/SettingsNetwork.vue'
import { setAppLocale } from '../../src/i18n'
import type { Connection } from '../../src/env'
import type { SettingsDraft } from '../../src/composables/settings/useSettingsDraft'

const connection = ref<Connection | null>(null)
const show = ref(false)
const network = ref(false)
const saved: unknown[] = []
const tests: unknown[] = []
const guides: string[] = []
let platform = 'win32'
let missing = false
const address = () => platform === 'darwin' ? '/private/tmp/com.apple.launchd.test/org.xquartz:0' : ':1'
function setPlatform(value: string) {
  platform = value
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: value === 'darwin' ? 'Macintosh; Mac OS X' : value === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0' })
}
const draft = ref({ x11AutoStartEnabled: true, x11ServerPath: '', autoReconnectEnabled: false } as SettingsDraft)
;(window as any).LiteConnect = {
  getGroups: async () => [{ id: 'default', name: '默认分组', isDefault: true }],
  getConnections: async () => [],
  getSavedCredentials: async () => [],
  getCredentialAutoFillEnabled: async () => false,
  getConnectionSecrets: async () => ({ password: '', privateKey: '', jumpPassword: '', jumpPrivateKey: '' }),
  saveConnection: async (value: unknown) => { saved.push(value); return value },
  getAppInfo: async () => ({ platform: 'win32-x64' }),
  getX11ServerStatus: async () => ({
    platform, supported: true, bundled: platform === 'win32',
    resolvedExecutablePath: platform === 'win32' ? 'C:/LiteConnect/resources/third-party/vcxsrv-runtime/vcxsrv.exe' : platform === 'darwin' && !missing ? '/Applications/Utilities/XQuartz.app' : null,
    displayAddress: platform !== 'win32' && !missing ? address() : undefined,
    dependencyMissing: missing ? platform === 'darwin' ? 'xquartz' : 'desktop' : undefined,
  }),
  testX11Server: async (opts: unknown) => { tests.push(opts); return { ready: true, started: false, host: '127.0.0.1', port: 6051, display: 51, displayAddress: platform !== 'win32' ? address() : undefined } },
  openX11SetupGuide: async () => { guides.push('xquartz') },
}
onMounted(() => {
  ;(window as any).__x11 = {
    saved, tests, guides,
    async mount(mode?: 'auto' | 'off' | 'custom', locale: 'zh-CN' | 'en-US' = 'zh-CN', os = 'win32') {
      show.value = false; network.value = false
      await nextTick(); setPlatform(os); setAppLocale(locale)
      connection.value = { id: 'fixture', name: 'Linux Installer', host: '10.0.0.1', port: 22, username: 'root', x11Forwarding: false, x11Mode: mode } as Connection
      show.value = true
    },
    async settings(os = 'win32', dependencyMissing = false) {
      show.value = false; network.value = false; await nextTick()
      setPlatform(os); missing = dependencyMissing
      network.value = true; await nextTick()
    },
  }
})
</script>

<template>
  <ConnectionForm v-if="show" :connection="connection" />
  <div v-if="network" class="network-fixture"><SettingsNetwork :draft="draft" /></div>
</template>

<style scoped>
.network-fixture { padding: 24px; max-width: 960px; margin: auto; }
</style>
