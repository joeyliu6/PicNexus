import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import Ripple from 'primevue/ripple';
import { PicNexusPreset } from '@/theme';
import VisualHarness from './VisualHarness.vue';

import 'primeicons/primeicons.css';
import '@/theme/dark-theme.css';
import '@/theme/light-theme.css';
import '@/theme/primevue-overrides.css';
import '@/theme/transitions.css';
import '@/styles/motion.css';
import '@/styles/bottom-bar-buttons.css';
import '@/style.css';
import './visual.css';

const app = createApp(VisualHarness);

app.use(PrimeVue, {
  theme: {
    preset: PicNexusPreset,
    options: {
      darkModeSelector: '.dark-theme',
      cssLayer: { name: 'primevue', order: 'reset, primevue, app' },
    },
  },
  ripple: false,
});

app.use(ToastService);
app.directive('tooltip', Tooltip);
app.directive('ripple', Ripple);
app.mount('#app');
