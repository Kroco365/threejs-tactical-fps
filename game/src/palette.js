// FOUNDRY PROTOCOL — the look plan in one place. Dusk foundry: cold slate, rust,
// hazard amber and one teal accent. The same names are the CSS custom properties
// in index.html. No other colour appears in the code.
export const PALETTE = {
  canvas: '#0e1116',
  floor: '#23262b',
  wall: '#2e3238',
  cover: '#3a3f46',
  rust: '#b4552d',
  hazard: '#e8a13a',
  teal: '#3fb8a6',
  ember: '#ff5a2a',
  ink: '#e8e4d8',
  muted: '#8b939c',
  ally: '#37c8ab',
  enemy: '#ff6a33',
};

export const NAMES = {
  game: 'FOUNDRY PROTOCOL',
  map: 'FOUNDRY-9',
  teamUs: 'VANGUARD',
  teamThem: 'EMBER',
  siteA: 'FURNACE HALL',
  siteB: 'COOLING YARD',
  bomb: 'SPIKE',
};

export function shade(name) {
  return PALETTE[name];
}
