'use strict';
/* ГЕГЕМОН — Сборка мира: страны, провинции, соседство, морские маршруты, подписи
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 7. СБОРКА МИРА: ДЕКОДИРОВАНИЕ, НАРЕЗКА ПРОВИНЦИЙ, СОСЕДИ И МОРСКИЕ ПУТИ
// -----------------------------------------------------------------------
const loadBarEl = document.getElementById('load-bar');
const loadStatusEl = document.getElementById('load-status');
const setProgress = (pct, msg) => { loadBarEl.style.width = pct + '%'; loadStatusEl.textContent = msg; };
const tickYield = () => new Promise((r) => setTimeout(r, 14));

async function buildWorld() {
  setProgress(10, 'Загрузка реальной карты мира...');
  const { features, isOffline } = await fetchWorldData((msg) => setProgress(18, msg));
  await tickYield();

  setProgress(38, 'Проецирование стран и нарезка на провинции...');
  spatialGrid = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);

  let countryIdx = 0;
  let nextProvId = 1;

  for (let fi = 0; fi < features.length; fi++) {
    const feat = features[fi];
    const rawIso = feat.id !== undefined && feat.id !== null ? String(feat.id).padStart(3, '0') : '';
    // Пропускаем Антарктиду (010)
    if (rawIso === '010' || feat.properties?.name === 'Antarctica') continue;

    const meta = ISO_META[rawIso] || NAME_FALLBACK[feat.properties?.name] || {
      name: feat.properties?.name || `Государство ${fi + 1}`,
      cap: 'Столица',
      flag: '🏳️',
      g: 'f'
    };

    // Проецируем кольца с чистым разрезанием антимеридиана (±180°)
    const projPolys = [];
    let totalArea = 0;
    for (const rawRing of feat.rings) {
      const safeRings = splitAntimeridianRing(rawRing);
      for (const lonLatRing of safeRings) {
        const pts = lonLatRing.map(([lo, la]) => projectMercator(lo, la));
        const area = Math.abs(polySignedArea(pts));
        if (area >= 14) {
          projPolys.push({ pts, area });
          totalArea += area;
        }
      }
    }
    if (projPolys.length === 0) continue;

    // Сортируем полигоны страны по убыванию площади
    projPolys.sort((a, b) => b.area - a.area);

    const color = makeCountryColor(countryIdx, meta.col);
    const capXY = meta.ll ? projectMercator(meta.ll[0], meta.ll[1]) : null;

    const country = {
      id: countryIdx,
      iso: rawIso || `X${countryIdx}`,
      name: meta.name,
      capitalName: meta.cap,
      flag: meta.flag,
      gender: meta.g || 'f',
      color,
      capXY,
      capitalProvId: null,
      money: 0,
      diplo: 25,
      alive: true,
      isAI: true,
      provinces: [],
      labelPos: { x: 0, y: 0, size: 12, visible: false },
      aiAggression: 0.3 + Math.random() * 0.55,
      honor: 70,
      grudge: {},
      warPlan: null,
      offerUntil: 0
    };

    // Распределяем целевое число провинций по крупным полигонам страны
    const targetTotal = targetProvincesForCountry(country.iso, totalArea);
    const subPolys = [];
    let remainingSeeds = targetTotal;

    for (let pi = 0; pi < projPolys.length; pi++) {
      const pp = projPolys[pi];
      // Мелкие осколочные островки оставляем целыми, если площадь заметна
      if (pp.area < 45 && pi > 0 && subPolys.length >= targetTotal) continue;
      let share = 1;
      if (remainingSeeds > 1 && pp.area > 90) {
        share = Math.max(1, Math.round((pp.area / totalArea) * targetTotal));
        if (pi === 0 && projPolys.length === 1) share = targetTotal;
        share = Math.min(share, Math.max(1, Math.floor(pp.area / 65)));
      }
      const cells = subdividePolygonVoronoi(pp.pts, share);
      for (const cell of cells) subPolys.push(cell);
      remainingSeeds = Math.max(1, remainingSeeds - cells.length);
    }

    if (subPolys.length === 0) continue;

    // Вычисляем общий центр страны для географического именования регионов
    let sumCx = 0, sumCy = 0, sumA = 0;
    const created = [];

    for (const poly of subPolys) {
      const area = Math.abs(polySignedArea(poly));
      if (area < 8) continue;
      const bbox = polyBBox(poly);
      const [cx, cy] = computeVisualCenter(poly, bbox);
      const path = new Path2D();
      path.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) path.lineTo(poly[i][0], poly[i][1]);
      path.closePath();

      const economy = Math.max(1, Math.min(6, Math.round(1 + Math.sqrt(area) / 16)));
      const pid = nextProvId++;
      const prov = {
        id: pid,
        name: country.capitalName,
        ownerId: country.id,
        origOwnerId: country.id,
        isCapital: false,
        poly,
        path,
        bbox,
        cx,
        cy,
        area,
        economy,
        fort: 0,
        draft: 1,           // доля призыва: 1 / 0.5 / 0.25 / 0 (выключен)
        troops: 140 + economy * 70,
      tanks: 0,
      air: 0,
        neighbors: new Set(),
        seaNeighbors: new Set(),
        edges: [], // { ax, ay, bx, by, adj } — для точных динамических границ
        isCoastal: false
      };
      game.provinces.push(prov);
      indexProvinceInGrid(prov);
      country.provinces.push(pid);
      created.push(prov);

      sumCx += cx * area;
      sumCy += cy * area;
      sumA += area;
    }

    if (created.length === 0) continue;

    const cCx = sumCx / sumA;
    const cCy = sumCy / sumA;
    let maxDist = 1;
    for (const p of created) {
      const d = Math.hypot(p.cx - cCx, p.cy - cCy);
      if (d > maxDist) maxDist = d;
    }

    // Выбираем столичную провинцию (ближайшая к реальным координатам столицы)
    let capProv = created[0];
    if (country.capXY) {
      let bestD = Infinity;
      for (const p of created) {
        const d = Math.hypot(p.cx - country.capXY[0], p.cy - country.capXY[1]);
        if (d < bestD) { bestD = d; capProv = p; }
      }
    } else {
      for (const p of created) {
        if (p.area > capProv.area) capProv = p;
      }
    }
    capProv.isCapital = true;
    capProv.name = country.capitalName;
    capProv.economy += 2;
    capProv.troops += 260;
    country.capitalProvId = capProv.id;

    // Географические названия остальных провинций
    const dirCounts = {};
    for (const p of created) {
      if (p === capProv) continue;
      const dx = p.cx - cCx, dy = p.cy - cCy;
      const dir = compassDir(dx, dy, Math.hypot(dx, dy), maxDist);
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
      p.name = formatGeoRegionName(dir, country.name, country.gender, dirCounts[dir]);
    }

    country.money = 360 + country.provinces.reduce((s, pid) => s + game.provinces[pid].economy * 45, 0);
    game.countries.push(country);
    if (rawIso) game.countryByIso.set(rawIso, country);
    countryIdx++;
  }

  setProgress(70, 'Анализ сухопутных границ и береговой линии...');
  await tickYield();

  // Определяем точное соседство провинций и классифицируем рёбра (берег / сосед)
  buildAdjacencyAndEdges();

  setProgress(86, 'Прокладка стратегических морских маршрутов...');
  await tickYield();

  buildSeaRoutes();
  rebuildBorders();
  recomputeAllLabels();

  initResources();
  initDiploIndex();
  snapshotBaseline();   // «чистый лист» — чтобы сценарий можно было снять без перезагрузки
  initModeSwitch();
  setProgress(100, 'Карта мира готова!');
  await tickYield();

  game.phase = 'select';
  resizeCanvas();
  resetCamera();
  populateCountryList();

  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('select-top').classList.remove('hidden');

  // На десктопе список стран удобно показать сразу, на мобильном — по кнопке «Список»
  if (window.innerWidth >= 820) {
    document.getElementById('country-picker').classList.remove('hidden');
  }

  if (isOffline) {
    pushToast('Карта запущена в офлайн-режиме (49 ключевых держав).');
  }

  await loadRemoteSaves();
  if (readSave() || readSave(PREV_KEY)) {
    document.getElementById('btn-continue').classList.remove('hidden');
    showContinueModal();
  }
}

// Построение сухопутного графа соседей и классификация рёбер полигонов
function buildAdjacencyAndEdges() {
  for (let pid = 1; pid < game.provinces.length; pid++) {
    const p = game.provinces[pid];
    const pts = p.poly;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.25) continue;

      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      const nx = -dy / len;
      const ny = dx / len;

      // Проверяем обе стороны ребра на малом смещении, чтобы найти соседа
      let adj = 0;
      const probes = [1.0, -1.0, 2.6, -2.6];
      for (let k = 0; k < probes.length; k++) {
        const hit = findProvinceAtWorld(mx + nx * probes[k], my + ny * probes[k], pid);
        if (hit !== 0) {
          adj = hit;
          break;
        }
      }

      if (adj !== 0) {
        p.neighbors.add(adj);
        game.provinces[adj].neighbors.add(pid);
      } else {
        p.isCoastal = true;
      }
      p.edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], adj });
    }
  }
}

// Сборка глобальных Path2D границ (жирные госграницы vs тонкие внутренние)
function rebuildBorders() {
  const countryP = new Path2D();
  const internalP = new Path2D();
  for (let pid = 1; pid < game.provinces.length; pid++) {
    const p = game.provinces[pid];
    const owner = p.ownerId;
    for (let i = 0; i < p.edges.length; i++) {
      const e = p.edges[i];
      if (e.adj === 0) {
        countryP.moveTo(e.ax, e.ay);
        countryP.lineTo(e.bx, e.by);
      } else if (e.adj > pid) {
        // Рисуем общее ребро один раз
        if (game.provinces[e.adj].ownerId !== owner) {
          countryP.moveTo(e.ax, e.ay);
          countryP.lineTo(e.bx, e.by);
        } else {
          internalP.moveTo(e.ax, e.ay);
          internalP.lineTo(e.bx, e.by);
        }
      }
    }
  }
  game.countryBorderPath = countryP;
  game.internalBorderPath = internalP;
}

function addSeaLane(pidA, pidB) {
  if (pidA === pidB) return;
  const pA = game.provinces[pidA], pB = game.provinces[pidB];
  if (!pA || !pB) return;
  if (pA.neighbors.has(pidB) || pA.seaNeighbors.has(pidB)) return;
  pA.seaNeighbors.add(pidB);
  pB.seaNeighbors.add(pidA);

  const midX = (pA.cx + pB.cx) * 0.5;
  const midY = (pA.cy + pB.cy) * 0.5;
  const dx = pB.cx - pA.cx, dy = pB.cy - pA.cy;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(48, len * 0.14);
  const mx = midX - (dy / len) * bend;
  const my = midY + (dx / len) * bend;
  game.seaRoutes.push({ a: pidA, b: pidB, x1: pA.cx, y1: pA.cy, x2: pB.cx, y2: pB.cy, mx, my });
}

function buildSeaRoutes() {
  // 1. Соединяем оторванные острова внутри одной страны (США-Аляска, Япония, Индонезия и т.д.)
  for (const c of game.countries) {
    if (c.provinces.length < 2) continue;
    const seen = new Set();
    const comps = [];
    for (const pid of c.provinces) {
      if (seen.has(pid)) continue;
      const comp = [], stack = [pid];
      seen.add(pid);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        const pr = game.provinces[cur];
        for (const nb of [...pr.neighbors, ...pr.seaNeighbors]) {
          if (game.provinces[nb].ownerId === c.id && !seen.has(nb)) {
            seen.add(nb); stack.push(nb);
          }
        }
      }
      comps.push(comp);
    }
    for (let k = 1; k < comps.length; k++) {
      let bestA = comps[0][0], bestB = comps[k][0], bestD = Infinity;
      for (const a of comps[0]) {
        for (const b of comps[k]) {
          const d = Math.hypot(game.provinces[a].cx - game.provinces[b].cx, game.provinces[a].cy - game.provinces[b].cy);
          if (d < bestD) { bestD = d; bestA = a; bestB = b; }
        }
      }
      if (bestD < 700) addSeaLane(bestA, bestB);
    }
  }

  // 2. Автоматические короткие проливы между близкими прибрежными провинциями
  const coastal = game.provinces.filter((p) => p && p.isCoastal);
  for (let i = 0; i < coastal.length; i++) {
    const a = coastal[i];
    let links = 0;
    for (let j = i + 1; j < coastal.length; j++) {
      const b = coastal[j];
      if (a.ownerId === b.ownerId || a.neighbors.has(b.id) || a.seaNeighbors.has(b.id)) continue;
      if (b.bbox.minX > a.bbox.maxX + 42 || b.bbox.maxX < a.bbox.minX - 42 ||
          b.bbox.minY > a.bbox.maxY + 42 || b.bbox.maxY < a.bbox.minY - 42) continue;
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d < 85 && links < 2) {
        addSeaLane(a.id, b.id);
        links++;
      }
    }
  }

  // 3. Гарантированные стратегические морские переправы между странами
  for (const [isoA, isoB] of SEA_ROUTE_PAIRS) {
    const cA = game.countryByIso.get(isoA);
    const cB = game.countryByIso.get(isoB);
    if (!cA || !cB) continue;
    const listA = cA.provinces.map((id) => game.provinces[id]).filter((p) => p.isCoastal);
    const listB = cB.provinces.map((id) => game.provinces[id]).filter((p) => p.isCoastal);
    const useA = listA.length ? listA : cA.provinces.map((id) => game.provinces[id]);
    const useB = listB.length ? listB : cB.provinces.map((id) => game.provinces[id]);
    if (!useA.length || !useB.length) continue;

    let bestA = useA[0], bestB = useB[0], bestD = Infinity;
    for (const pa of useA) {
      for (const pb of useB) {
        const d = Math.hypot(pa.cx - pb.cx, pa.cy - pb.cy);
        if (d < bestD) { bestD = d; bestA = pa; bestB = pb; }
      }
    }
    addSeaLane(bestA.id, bestB.id);
  }
}

function recomputeCountryLabel(countryId) {
  const c = game.countries[countryId];
  if (!c || c.provinces.length === 0) {
    if (c) c.labelPos.visible = false;
    return;
  }
  const seen = new Set();
  let bestCluster = [], bestArea = -1;
  for (const pid of c.provinces) {
    if (seen.has(pid)) continue;
    const cluster = [], stack = [pid];
    let area = 0;
    seen.add(pid);
    while (stack.length) {
      const cur = stack.pop();
      const pr = game.provinces[cur];
      cluster.push(pr);
      area += pr.area;
      for (const nb of pr.neighbors) {
        if (game.provinces[nb].ownerId === countryId && !seen.has(nb)) {
          seen.add(nb); stack.push(nb);
        }
      }
    }
    if (area > bestArea) { bestArea = area; bestCluster = cluster; }
  }
  let wx = 0, wy = 0, wSum = 0;
  let minX = WORLD_W, maxX = 0;
  for (const pr of bestCluster) {
    wx += pr.cx * pr.area; wy += pr.cy * pr.area; wSum += pr.area;
    if (pr.bbox.minX < minX) minX = pr.bbox.minX;
    if (pr.bbox.maxX > maxX) maxX = pr.bbox.maxX;
  }
  const spanW = maxX - minX;
  const size = Math.max(6, Math.min(24, Math.sqrt(bestArea) * 0.145, spanW / Math.max(4, c.name.length * 0.55)));
  c.labelPos = { x: wx / (wSum || 1), y: wy / (wSum || 1), size, visible: bestArea >= 200 };
}

function recomputeAllLabels() {
  for (let i = 0; i < game.countries.length; i++) recomputeCountryLabel(i);
}
