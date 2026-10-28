import { createApp } from 'vue'
import i18n from '../../src/i18n'
import '../../src/styles/main.css'
import '../../src/styles/settings.css'
import Fixture from './X11Fixture.vue'

const app = createApp(Fixture).use(i18n)
app.config.errorHandler = error => { (window as any).__x11Error = String(error) }
app.mount('#app')
