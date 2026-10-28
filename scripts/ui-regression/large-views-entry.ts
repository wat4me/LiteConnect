import { createApp } from 'vue'
import '../../src/styles/main.css'
import i18n from '../../src/i18n'
import Fixture from './LargeViewsFixture.vue'
createApp(Fixture).use(i18n).mount('#app')
