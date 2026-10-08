import { createApp } from 'vue'
import { ElTooltip } from 'element-plus/es/components/tooltip/index'
import i18n from '../../src/i18n'
import Fixture from './Fixture.vue'
import '../../src/styles/main.css'
import 'element-plus/es/components/tooltip/style/css'

const app = createApp(Fixture)
app.use(i18n)
app.component('ElTooltip', ElTooltip)
app.config.errorHandler = (error) => {
  (window as any).__uiError = String(error)
  console.error(error)
}
app.mount('#app')
