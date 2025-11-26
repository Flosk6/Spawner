import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: '.dark-theme',
      cssLayer: false
    }
  },
  ripple: true,
  pt: {
    global: {
      css: `
        :root {
          --p-primary-50: #f4f3f8;
          --p-primary-100: #e9e7f1;
          --p-primary-200: #d3cfe3;
          --p-primary-300: #bdb7d5;
          --p-primary-400: #a79fc7;
          --p-primary-500: #574B89;
          --p-primary-600: #4c4279;
          --p-primary-700: #413869;
          --p-primary-800: #362f59;
          --p-primary-900: #2b2549;
          --p-primary-950: #1a1729;
        }
      `
    }
  }
})
app.use(ToastService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

app.mount('#app')
