import { createApp } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElTooltip } from 'element-plus/es/components/tooltip/index'

// On-demand component styles (replaces ~200KB element-plus/dist/index.css)
import 'element-plus/es/components/base/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/tooltip/style/css'

import App from './App.vue'
import './styles/main.css'
import i18n, { initLocaleFromStorage } from './i18n'
import { migrateLegacyLocalStorage } from './utils/legacyStorageMigrate'

migrateLegacyLocalStorage()
initLocaleFromStorage()

const app = createApp(App)
app.use(i18n)

// Register Element Plus components globally
app.component('ElTooltip', ElTooltip)

// Make Element Plus toast available globally
app.config.globalProperties.$message = ElMessage

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', err, info)
}

window.addEventListener('error', (event) => {
  console.error('[Unhandled Error]', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise]', event.reason)
})

app.mount('#app')
