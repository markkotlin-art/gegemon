'use strict';
/* ГЕГЕМОН — Проекция Меркатора, декодер TopoJSON, геометрия и Voronoi-нарезка провинций
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 3. ЧИСТЫЙ JS: ПРОЕКЦИЯ МЕРКАТОРА И ДЕКОДЕР TOPOJSON С АНТИМЕРИДИАНОМ
// -----------------------------------------------------------------------
function projectMercator(lon, lat) {
  const clampedLon = Math.max(-180, Math.min(180, lon));
  const clampedLat = Math.max(LAT_MIN, Math.min(LAT_MAX, lat));
  const x = ((clampedLon + 180) / 360) * WORLD_W;
  const rad = clampedLat * Math.PI / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  const t = (MERC_MAX - merc) / (MERC_MAX - MERC_MIN);
  const y = 18 + t * (WORLD_H - 36);
  return [x, y];
}

// Отсечение полигона в градусах по вертикальной прямой x <= limit или x >= limit
function clipRingLon(ring, limit, keepLess) {
  if (!ring || ring.length < 3) return [];
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const inA = keepLess ? a[0] <= limit : a[0] >= limit;
    const inB = keepLess ? b[0] <= limit : b[0] >= limit;
    if (inA && inB) {
      out.push(b);
    } else if (inA && !inB) {
      const t = (limit - a[0]) / ((b[0] - a[0]) || 1e-9);
      out.push([limit, a[1] + t * (b[1] - a[1])]);
    } else if (!inA && inB) {
      const t = (limit - a[0]) / ((b[0] - a[0]) || 1e-9);
      out.push([limit, a[1] + t * (b[1] - a[1])]);
      out.push(b);
    }
  }
  return out;
}

// Безопасное разбиение кольца, пересекающего ±180° (убирает горизонтальные полосы у России, США, Фиджи)
function splitAntimeridianRing(ring) {
  if (ring.length < 3) return [];
  // Разворачиваем долготу непрерывно (unwrap)
  const unwrapped = [[ring[0][0], ring[0][1]]];
  let minLon = ring[0][0], maxLon = ring[0][0];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = unwrapped[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    unwrapped.push([lon, ring[i][1]]);
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  // Если кольцо не пересекает ±180°, возвращаем сразу
  if (minLon >= -180 && maxLon <= 180) {
    return [unwrapped];
  }
  // Иначе режем на куски в пределах [-179.95, 179.95] со сдвигами -360, 0, +360
  const pieces = [];
  for (const shift of [-360, 0, 360]) {
    if (maxLon + shift < -180 || minLon + shift > 180) continue;
    const shifted = unwrapped.map(([x, y]) => [x + shift, y]);
    let clipped = clipRingLon(shifted, -179.95, false);
    clipped = clipRingLon(clipped, 179.95, true);
    if (clipped.length >= 3) pieces.push(clipped);
  }
  return pieces;
}

// Чистый JS-декодер TopoJSON (~35 строк)
function decodeTopoJSON(topology, objectName) {
  const tf = topology.transform || { scale: [1, 1], translate: [0, 0] };
  const [sx, sy] = tf.scale;
  const [tx, ty] = tf.translate;

  // Декодируем дельта-закодированные дуги
  const decodedArcs = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    const pts = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      pts[i] = [x * sx + tx, y * sy + ty];
    }
    return pts;
  });

  function stitchRing(arcIndices) {
    const ring = [];
    for (let i = 0; i < arcIndices.length; i++) {
      const idx = arcIndices[i];
      const arc = idx < 0 ? decodedArcs[~idx].slice().reverse() : decodedArcs[idx];
      const start = i === 0 ? 0 : 1;
      for (let j = start; j < arc.length; j++) ring.push(arc[j]);
    }
    return ring;
  }

  const obj = topology.objects[objectName] || Object.values(topology.objects)[0];
  const features = [];
  for (const g of obj.geometries) {
    let polys = [];
    if (g.type === 'Polygon') {
      if (g.arcs && g.arcs[0]) polys.push(stitchRing(g.arcs[0]));
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.arcs) {
        if (poly && poly[0]) polys.push(stitchRing(poly[0]));
      }
    }
    features.push({ id: g.id, properties: g.properties || {}, rings: polys });
  }
  return features;
}

// Преобразование GeoJSON (резервного) к тому же формату features
function parseGeoJSONFeatures(geo) {
  const out = [];
  for (const f of geo.features) {
    const rings = [];
    if (f.geometry.type === 'Polygon') {
      rings.push(f.geometry.coordinates[0]);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const p of f.geometry.coordinates) rings.push(p[0]);
    }
    out.push({ id: f.id, properties: f.properties || {}, rings });
  }
  return out;
}

// Карта мира берётся из локального файла data/countries-110m.js (window.WORLD_TOPO),
// поэтому игра открывается двойным кликом по index.html и работает без интернета.
async function fetchWorldData(onStep) {
  onStep('Загрузка карты мира...');
  try {
    const topo = window.WORLD_TOPO;
    if (topo && topo.arcs && topo.objects) {
      return { features: decodeTopoJSON(topo, 'countries'), isOffline: false };
    }
  } catch (_) {}
  onStep('Не удалось прочитать карту — запускаем встроенную карту мира...');
  return { features: parseGeoJSONFeatures(OFFLINE_FALLBACK_GEOJSON), isOffline: true };
}

// -----------------------------------------------------------------------
// 4. ГЕОМЕТРИЯ: ПЛОЩАДЬ, POINT-IN-POLYGON И SUTHERLAND-HODGMAN VORONOI
// -----------------------------------------------------------------------
function polySignedArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return a * 0.5;
}

function polyBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0], y = pts[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Вычисление гарантированной внутренней точки полигона (для бейджа войск)
function computeVisualCenter(pts, bbox) {
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) { sx += pts[i][0]; sy += pts[i][1]; }
  const cx = sx / pts.length;
  const cy = sy / pts.length;
  if (pointInPolygon(cx, cy, pts)) return [cx, cy];

  // Если полигон вогнутый и центроид снаружи — ищем ближайшую внутреннюю точку по сетке
  const steps = 9;
  const dx = (bbox.maxX - bbox.minX) / steps;
  const dy = (bbox.maxY - bbox.minY) / steps;
  let bestX = cx, bestY = cy, bestD = Infinity;
  for (let gx = 1; gx < steps; gx++) {
    for (let gy = 1; gy < steps; gy++) {
      const tx = bbox.minX + gx * dx;
      const ty = bbox.minY + gy * dy;
      if (pointInPolygon(tx, ty, pts)) {
        const d = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
        if (d < bestD) { bestD = d; bestX = tx; bestY = ty; }
      }
    }
  }
  return [bestX, bestY];
}

// Чистый JS Sutherland-Hodgman: отсечение полигона полуплоскостью (P - M) · N <= 0
function clipPolygonHalfPlane(pts, mx, my, nx, ny) {
  if (!pts || pts.length < 3) return [];
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const da = (a[0] - mx) * nx + (a[1] - my) * ny;
    const db = (b[0] - mx) * nx + (b[1] - my) * ny;
    const inA = da <= 1e-6;
    const inB = db <= 1e-6;
    if (inA && inB) {
      out.push(b);
    } else if (inA && !inB) {
      const t = da / ((da - db) || 1e-9);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    } else if (!inA && inB) {
      const t = da / ((da - db) || 1e-9);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      out.push(b);
    }
  }
  return out;
}

// Нарезка одного полигона на k органичных субпровинций (K-means++ + Lloyd + Voronoi clipping)
function subdividePolygonVoronoi(poly, k) {
  if (k <= 1) return [poly];
  const bbox = polyBBox(poly);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (w < 6 || h < 6) return [poly];

  // Семплируем внутренние точки полигона по регулярной сетке
  const gridN = Math.max(12, Math.min(28, Math.ceil(Math.sqrt(k * 45))));
  const samples = [];
  for (let gx = 0; gx < gridN; gx++) {
    const tx = bbox.minX + ((gx + 0.5) / gridN) * w;
    for (let gy = 0; gy < gridN; gy++) {
      const ty = bbox.minY + ((gy + 0.5) / gridN) * h;
      if (pointInPolygon(tx, ty, poly)) samples.push([tx, ty]);
    }
  }
  if (samples.length < k * 2) return [poly];

  // Детерминированный K-means++ (самые удалённые друг от друга центры)
  const seeds = [samples[Math.floor(samples.length / 2)].slice()];
  for (let s = 1; s < k; s++) {
    let bestPt = samples[0], bestMinD = -1;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      let minD = Infinity;
      for (let j = 0; j < seeds.length; j++) {
        const dx = p[0] - seeds[j][0], dy = p[1] - seeds[j][1];
        const d = dx * dx + dy * dy;
        if (d < minD) minD = d;
      }
      if (minD > bestMinD) { bestMinD = minD; bestPt = p; }
    }
    seeds.push(bestPt.slice());
  }

  // 5 итераций Lloyd relaxation для ровных провинций
  for (let iter = 0; iter < 5; iter++) {
    const sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Uint32Array(k);
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      let best = 0, bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const dx = p[0] - seeds[j][0], dy = p[1] - seeds[j][1];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      sx[best] += p[0]; sy[best] += p[1]; cnt[best]++;
    }
    for (let j = 0; j < k; j++) {
      if (cnt[j] > 0) { seeds[j][0] = sx[j] / cnt[j]; seeds[j][1] = sy[j] / cnt[j]; }
    }
  }

  // Voronoi-клиппинг каждого семени по серединным перпендикулярам ко всем остальным
  const cells = [];
  for (let i = 0; i < k; i++) {
    let cell = poly;
    const si = seeds[i];
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const sj = seeds[j];
      const mx = (si[0] + sj[0]) * 0.5;
      const my = (si[1] + sj[1]) * 0.5;
      const nx = sj[0] - si[0];
      const ny = sj[1] - si[1];
      cell = clipPolygonHalfPlane(cell, mx, my, nx, ny);
      if (cell.length < 3) break;
    }
    if (cell.length >= 3 && Math.abs(polySignedArea(cell)) > 4) {
      cells.push(cell);
    }
  }
  return cells.length > 0 ? cells : [poly];
}

function targetProvincesForCountry(iso, totalArea) {
  const fixed = {
    '643': 18, '840': 14, '156': 13, '124': 10, '076': 10,
    '356': 8,  '036': 8,  '398': 6,  '032': 6,  '484': 6,
    '804': 6,  '250': 6,  '792': 6,  '364': 6,  '682': 6,
    '360': 6,  '724': 5,  '276': 5,  '380': 5,  '616': 5,
    '826': 5,  '392': 5,  '012': 5,  '180': 5,  '818': 4,
    '710': 4,  '112': 4,  '752': 4,  '578': 4,  '246': 3,
    '642': 3,  '586': 4,  '566': 4,  '231': 4,  '496': 4
  };
  if (fixed[iso]) return fixed[iso];
  if (totalArea < 240) return 1;
  if (totalArea < 720) return 2;
  if (totalArea < 1600) return 3;
  if (totalArea < 3200) return 4;
  if (totalArea < 6000) return 5;
  return 6;
}

function formatGeoRegionName(dirKey, countryName, gender, dupNum) {
  const forms = {
    N:  { f: 'Северная',        m: 'Северный',        p: 'Северные' },
    NE: { f: 'Северо-Восточная',m: 'Северо-Восточный',p: 'Северо-Восточные' },
    E:  { f: 'Восточная',       m: 'Восточный',       p: 'Восточные' },
    SE: { f: 'Юго-Восточная',   m: 'Юго-Восточный',   p: 'Юго-Восточные' },
    S:  { f: 'Южная',           m: 'Южный',           p: 'Южные' },
    SW: { f: 'Юго-Западная',    m: 'Юго-Западный',    p: 'Юго-Западные' },
    W:  { f: 'Западная',        m: 'Западный',        p: 'Западные' },
    NW: { f: 'Северо-Западная', m: 'Северо-Западный', p: 'Северо-Западные' },
    C:  { f: 'Центральная',     m: 'Центральный',     p: 'Центральные' }
  };
  const adj = (forms[dirKey] || forms.C)[gender || 'f'];
  return `${adj} ${countryName}${dupNum > 1 ? ' ' + dupNum : ''}`;
}

function compassDir(dx, dy, dist, maxDist) {
  if (dist < maxDist * 0.22) return 'C';
  const deg = Math.atan2(dy, dx) * 180 / Math.PI;
  if (deg >= -112.5 && deg < -67.5) return 'N';
  if (deg >= -67.5 && deg < -22.5) return 'NE';
  if (deg >= -22.5 && deg < 22.5) return 'E';
  if (deg >= 22.5 && deg < 67.5) return 'SE';
  if (deg >= 67.5 && deg < 112.5) return 'S';
  if (deg >= 112.5 && deg < 157.5) return 'SW';
  if (deg >= 157.5 || deg < -157.5) return 'W';
  return 'NW';
}
