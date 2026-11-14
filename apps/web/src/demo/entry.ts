// Entry point of the demo build (VITE_DEMO=1): fake backend first, then the unchanged app.
import { installDemo } from './mock';
import { mountDemoBanner } from './banner';
import './demo.css';

installDemo();
mountDemoBanner();
await import('../app/main');
