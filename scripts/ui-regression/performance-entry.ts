import { createApp } from 'vue'
import { ElTooltip } from 'element-plus/es/components/tooltip/index'
import 'element-plus/es/components/base/style/css'
import 'element-plus/es/components/tooltip/style/css'
import '../../src/styles/main.css'
import i18n from '../../src/i18n'
import Fixture from './PerformanceFixture.vue'

createApp(Fixture).use(i18n).component('ElTooltip', ElTooltip).mount('#app')
