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
      darkModeSelector: '.dark',
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

        .dark {
          --p-surface-0: #1a1625;
          --p-surface-50: #1f1b2e;
          --p-surface-100: #2a2540;
          --p-surface-200: #352e52;
          --p-surface-300: #403764;
          --p-surface-400: #4b4076;
          --p-surface-500: #564988;
          --p-surface-600: #61529a;
          --p-surface-700: #6c5bac;
          --p-surface-800: #7764be;
          --p-surface-900: #826dd0;
          --p-surface-950: #0f0d19;

          /* PrimeVue component backgrounds */
          --p-content-background: #1a1625;
          --p-content-border-color: rgba(147, 51, 234, 0.2);
          --p-text-color: #e5e7eb;
          --p-text-hover-color: #ffffff;
          --p-surface-hover: rgba(147, 51, 234, 0.1);
        }
      `
    }
  }
})
app.use(ToastService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

app.mount('#app')
