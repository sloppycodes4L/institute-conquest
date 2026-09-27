import './style.css';
import { App } from './ui/app.ts';

const app = new App();
if (import.meta.env.DEV) (window as any).__app = app;
