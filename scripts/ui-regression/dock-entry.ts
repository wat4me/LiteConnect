import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import i18n from '../../src/i18n'
import Fixture from './DockFixture.vue'
import '../../src/styles/main.css'
const app = createApp(Fixture).use(i18n).use(ElementPlus)
app.config.errorHandler = error => { (window as any).__dockError = error instanceof Error ? error.stack : String(error); console.error(error) }
window.addEventListener('unhandledrejection', event => { (window as any).__dockError = String(event.reason) })
app.mount('#app')
