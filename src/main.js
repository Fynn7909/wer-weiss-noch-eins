import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import './ui/styles.css';
import { startApp } from './ui/app.js';

// Jede JSON-Datei in src/data ist eine Kategorie (oder, in themen/, eine Liste davon). Hauptkategorien zuerst.
const files = import.meta.glob('./data/**/*.json', { eager: true, import: 'default' });
const ORDER = ['countries', 'food', 'animals'];
const rank = (c) => (ORDER.includes(c.id) ? ORDER.indexOf(c.id) : ORDER.length);
const categories = Object.values(files)
  .flat()
  .sort((a, b) => rank(a) - rank(b));

startApp(document.getElementById('app'), categories);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
