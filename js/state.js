'use strict';
/* ГЕГЕМОН — Состояние игры (объект game), пространственный хэш, отношения между странами
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 6. СОСТОЯНИЕ ИГРЫ И ПРОСТРАНСТВЕННЫЙ ХЭШ ДЛЯ БЫСТРОГО HIT-TEST
// -----------------------------------------------------------------------
const canvas = document.getElementById('worldCanvas');
const ctx = canvas.getContext('2d');

const GRID_CELL = 50;
const GRID_COLS = Math.ceil(WORLD_W / GRID_CELL);
const GRID_ROWS = Math.ceil(WORLD_H / GRID_CELL);
let spatialGrid = [];

const game = {
  phase: 'loading', // 'loading' | 'select' | 'playing' | 'ended'
  countries: [],
  countryByIso: new Map(),
  provinces: [null], // 1-indexed
  seaRoutes: [],
  relations: new Map(),

  playerId: null,
  selectedCountryId: null,
  selectedProvId: null,
  hoveredProvId: null,
  sendPercent: 75,
  mapMode: 'political', // 'political' | 'diplomatic' | 'military'

  speed: 1, // 0, 1, 2, 3
  year: 2026,
  month: 0,
  dayFloat: 0,
  totalMonths: 0,
  aiTimer: 0,

  marches: [],
  battles: [],
  events: [],

  // Кэшированные Path2D границ (пересобираются только при захвате провинций)
  countryBorderPath: null,
  internalBorderPath: null,

  cam: { x: 0, y: 0, zoom: 1, minZoom: 0.3, maxZoom: 9 },
  viewW: window.innerWidth,
  viewH: window.innerHeight,
  victoryShown: false,
  time: 0
};

// Вспомогательные функции
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0)), g = Math.round(255 * f(8)), b = Math.round(255 * f(4));
  return `rgb(${r},${g},${b})`;
}

function makeCountryColor(idx, preset) {
  if (preset) return preset;
  const hue = (idx * 137.508 + 22) % 360;
  const sat = 38 + (idx % 3) * 10;
  const lig = 36 + ((idx >> 1) % 3) * 6;
  return hslToHex(hue, sat, lig);
}

function fmtNum(n) {
  n = Math.floor(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return n < 1000 ? String(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

function drawRoundRect(c, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

function getRelKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
function getRelation(a, b) {
  if (a === b) return { status: 'self' };
  const key = getRelKey(a, b);
  let rel = game.relations.get(key);
  if (!rel) {
    rel = { status: 'neutral', sinceMonth: 0, pactUntil: 0, warScoreA: 0, warScoreB: 0 };
    game.relations.set(key, rel);
  }
  return rel;
}
function isAtWar(a, b)  { return a !== b && getRelation(a, b).status === 'war'; }
function isAllied(a, b) { return a !== b && getRelation(a, b).status === 'ally'; }
function hasPact(a, b)  { const r = getRelation(a, b); return a !== b && r.status === 'pact' && r.pactUntil > game.totalMonths; }

function indexProvinceInGrid(prov) {
  const c0 = Math.max(0, Math.floor(prov.bbox.minX / GRID_CELL));
  const c1 = Math.min(GRID_COLS - 1, Math.floor(prov.bbox.maxX / GRID_CELL));
  const r0 = Math.max(0, Math.floor(prov.bbox.minY / GRID_CELL));
  const r1 = Math.min(GRID_ROWS - 1, Math.floor(prov.bbox.maxY / GRID_CELL));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      spatialGrid[r * GRID_COLS + c].push(prov.id);
    }
  }
}

function findProvinceAtWorld(wx, wy, ignoreId = 0) {
  if (wx < 0 || wx >= WORLD_W || wy < 0 || wy >= WORLD_H) return 0;
  const c = Math.floor(wx / GRID_CELL);
  const r = Math.floor(wy / GRID_CELL);
  const list = spatialGrid[r * GRID_COLS + c];
  if (!list) return 0;
  for (let i = 0; i < list.length; i++) {
    const pid = list[i];
    if (pid === ignoreId) continue;
    const p = game.provinces[pid];
    const b = p.bbox;
    if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) continue;
    if (pointInPolygon(wx, wy, p.poly)) return pid;
  }
  return 0;
}
