import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './styles.css';
import { loadGame } from './game/save';
import { App } from './ui/app';

const root = document.getElementById('app')!;
new App(root, loadGame(Date.now()));

// Empeche le menu contextuel et le zoom au double-tap : on tapote beaucoup ici.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
