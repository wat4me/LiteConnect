import { createApp } from 'vue'
import i18n from '../../src/i18n'
import Fixture from './NavigationFixture.vue'
import '../../src/styles/main.css'
const app = createApp(Fixture).use(i18n)
app.config.errorHandler = error => { (window as any).__navigationError = String(error) }
app.mount('#app')
