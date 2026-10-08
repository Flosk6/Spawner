import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/black-ops-one';
import './styles/tokens.css';
import './style.css';
import App from './App.vue';
import router from './router';
import { SpawnerPreset } from './theme/preset';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: SpawnerPreset,
    options: {
      prefix: 'p',
      darkModeSelector: '.dark',
      cssLayer: { name: 'primevue', order: 'tailwind-base, primevue, tailwind-utilities' },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);

app.mount('#app');
