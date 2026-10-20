// Gezeichnete Spielerfiguren im Stil der Referenz: freigestellte Person vor heller Wand.

export const PLAYER_LOOKS = [
  { top: '#262626', pants: '#9db6cf', skin: '#e9c2a6', hair: '#4a3426', style: 'short' },
  { top: '#a3a29d', pants: '#8f8e8a', skin: '#f1d2bc', hair: '#5b4030', style: 'long' },
  { top: '#c4b49a', pants: '#2f2f2f', skin: '#8a5a3c', hair: '#1d1712', style: 'curly' },
  { top: '#6f806b', pants: '#c9c3b5', skin: '#d6a585', hair: '#2a1e16', style: 'short' },
  { top: '#3d566f', pants: '#d9d4c7', skin: '#f3d7c4', hair: '#c79a5a', style: 'long' },
  { top: '#b06a43', pants: '#3a3a3a', skin: '#5e3b27', hair: '#141010', style: 'curly' },
  { top: '#e4ded2', pants: '#7d93ad', skin: '#e2b896', hair: '#7a3e1f', style: 'long' },
  { top: '#6e5a7e', pants: '#2b2b2b', skin: '#c48e6a', hair: '#231a14', style: 'short' },
];

export const lookFor = (id) => PLAYER_LOOKS[id % PLAYER_LOOKS.length];

function hair(style, color) {
  if (style === 'long')
    return `<path d="M33 34c0-14 9-22 17-22s17 8 17 22v26c-3 3-6 4-8 4V36c-4-4-14-4-18 0v28c-2 0-5-1-8-4z" fill="${color}"/>`;
  if (style === 'curly')
    return `<g fill="${color}"><circle cx="38" cy="26" r="8"/><circle cx="50" cy="20" r="9"/><circle cx="62" cy="26" r="8"/><circle cx="35" cy="34" r="5"/><circle cx="65" cy="34" r="5"/></g>`;
  return `<path d="M35 32c0-13 7-20 15-20 9 0 16 6 15 19-3-5-8-7-15-7s-12 3-15 8z" fill="${color}"/>`;
}

/** SVG einer stehenden Figur. viewBox 100×240, Füße bei y≈232. */
export function figureSVG(id) {
  const l = lookFor(id);
  return `<svg viewBox="0 0 100 240" aria-hidden="true">
    <ellipse cx="50" cy="234" rx="30" ry="4" fill="#000" opacity=".07"/>
    <path d="M36 146h28l4 82c0 4-3 5-7 5h-7l-4-70-4 70h-7c-4 0-7-1-7-5z" fill="${l.pants}"/>
    <path d="M37 228h11v5H34c0-3 1-5 3-5zM52 228h11c2 0 3 2 3 5H52z" fill="#2a2a2a"/>
    <path d="M50 58c-15 0-26 5-29 16l-5 66c0 4 2 6 5 6h4l3-48 1 50h42l1-50 3 48h4c3 0 5-2 5-6l-5-66c-3-11-14-16-29-16z" fill="${l.top}"/>
    <path d="M42 58c2 5 5 7 8 7s6-2 8-7" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="2"/>
    <rect x="45" y="48" width="10" height="12" rx="4" fill="${l.skin}"/>
    <ellipse cx="50" cy="34" rx="13" ry="16" fill="${l.skin}"/>
    ${hair(l.style, l.hair)}
  </svg>`;
}

/** Kleiner runder Punkt in Spielerfarbe für Listen. */
export function dotHTML(id) {
  const l = lookFor(id);
  return `<span class="pdot" style="--c:${l.top};--s:${l.skin}"></span>`;
}
