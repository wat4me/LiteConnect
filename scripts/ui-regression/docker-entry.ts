import { createApp } from 'vue'
import i18n from '../../src/i18n'
import DockerFixture from './DockerFixture.vue'
import '../../src/styles/main.css'

const app = createApp(DockerFixture)
app.use(i18n)
app.config.errorHandler = error => { (window as any).__uiError = String(error) }
app.mount('#app')
