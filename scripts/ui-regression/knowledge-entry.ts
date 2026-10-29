import { createApp } from 'vue'
import i18n from '../../src/i18n'
import Fixture from './KnowledgeFixture.vue'
import '../../src/styles/main.css'
import '../../src/styles/settings.css'
const app = createApp(Fixture).use(i18n)
app.config.errorHandler = error => { (window as any).__knowledgeError = String(error) }
app.mount('#app')
