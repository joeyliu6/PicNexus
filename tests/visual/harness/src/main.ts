import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import Ripple from 'primevue/ripple';
import { PicNexusPreset } from '@/theme/preset';
import VisualHarness from './VisualHarness.vue';

import 'primeicons/primeicons.css';
import '@/theme/dark-theme.css';
import '@/theme/light-theme.css';
import '@/theme/primevue-overrides.css';
import '@/styles/motion.css';
import '@/styles/tokens.css';
import '@/styles/tokens-extra.css';
import '@/styles/pn-base.css';
import '@/styles/bottom-bar-buttons.css';
import '@/styles/app.css';
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

app.directive('tooltip', Tooltip);
app.directive('ripple', Ripple);
app.mount('#app');
