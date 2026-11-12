import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

import '@/assets/css/main.scss'
import '@/assets/css/tailwind.css'

import {registerEcharts} from "@/plugins/echarts"
// Aquaculture preview data is provided by its own data module.
// Leave the template's global XHR mock disabled for future device integration.

const app = createApp(App)
registerEcharts(app)
app.use(createPinia())
app.use(router)

app.mount('#app')
