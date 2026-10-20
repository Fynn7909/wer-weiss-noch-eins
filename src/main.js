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

// Darkmode-Umschalter oben rechts. Ohne gespeicherte Wahl folgt er dem System.
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const themeBtn = document.createElement('button');
themeBtn.className = 'theme-toggle';
document.body.append(themeBtn);
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.innerHTML = dark ? SUN : MOON;
  themeBtn.setAttribute('aria-label', dark ? 'Hellen Modus einschalten' : 'Dunklen Modus einschalten');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121211' : '#f1f0ee');
}
let saved = null;
try {
  saved = localStorage.getItem('theme');
} catch {}
setTheme(saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  setTheme(dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {}
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
