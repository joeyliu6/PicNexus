import { createApp } from 'vue';
import './styles/app.css';
import './theme/dark-theme.css';
import './theme/light-theme.css';
import './styles/motion.css';
import 'primeicons/primeicons.css';
import TrayMenuWindow from './components/tray/TrayMenuWindow.vue';

createApp(TrayMenuWindow).mount('#app');
