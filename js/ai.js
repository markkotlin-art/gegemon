'use strict';
/* ГЕГЕМОН — Ход ИИ-стран и ежемесячный тик
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 9. АВТОНОМНЫЙ ИИ И МЕСЯЧНЫЙ ТИК
// -----------------------------------------------------------------------
function processMonth() {
  game.month++;
  game.totalMonths++;
  if (game.month >= 12) { game.month = 0; game.year++; }

  for (const c of game.countries) {
    if (!c.alive) continue;
    const st = getCountryStats(c.id);
    c.money += st.income;
    c.diplo = Math.min(100, c.diplo + 3);
    processEconomy(c);
    for (const pid of c.provinces) {
      const p = game.provinces[pid];
      // при голоде новобранцев нет
      if (!c.starving) p.troops += provDraftGrowth(p);
    }
  }
  for (const [, rel] of game.relations) {
    if (rel.status === 'pact' && rel.pactUntil <= game.totalMonths) rel.status = 'neutral';
  }
  processDiplomacyMonth();
  updateHud();
  saveGame(true);
}

function processAIStep() {
  const aliveAI = game.countries.filter((c) => c.alive && c.id !== game.playerId);
  const batch = Math.min(16, aliveAI.length);
  for (let k = 0; k < batch; k++) {
    runAIForCountry(aliveAI[Math.floor(Math.random() * aliveAI.length)]);
  }
}

// Анализ положения страны: фронт, тыл, угрозы
function aiAnalyze(c) {
  const enemies = new Set(enemiesOf(c.id));
  const staging = c.warPlan ? c.warPlan.targetId : null;   // готовится к нападению: стягивает силы к границе
  const foeSet = new Set(enemies);
  if (staging !== null) foeSet.add(staging);

  const front = [];      // провинции у линии соприкосновения с врагом / целью
  const border = [];     // остальные пограничные
  const interior = [];
  const foeProvs = [];   // провинции врагов (для расчёта расстояния до фронта)
  for (const f of foeSet) for (const pid of game.countries[f].provinces) foeProvs.push(game.provinces[pid]);

  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    let touchesFoe = false, touchesForeign = false, threat = 0;
    for (const { id: nb, isSea } of getReachableNeighbors(pid)) {
      const nbP = game.provinces[nb];
      if (nbP.ownerId === c.id) continue;
      touchesForeign = true;
      if (enemies.has(nbP.ownerId)) { touchesFoe = true; threat += provPower(nbP) * (isSea ? 0.8 : 1); }
      else if (foeSet.has(nbP.ownerId)) touchesFoe = true;
    }
    p._threat = threat;
    if (touchesFoe) front.push(p);
    else if (touchesForeign) border.push(p);
    else interior.push(p);
  }
  // Расстояние от каждой своей провинции до ближайшей вражеской
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    let best = Infinity;
    for (const e of foeProvs) {
      const d = Math.hypot(p.cx - e.cx, p.cy - e.cy);
      if (d < best) best = d;
    }
    p._frontDist = best;
  }
  return { enemies, staging, front, border, interior, inWar: enemies.size > 0 };
}

function runAIForCountry(c) {
  if (!c.alive || c.provinces.length === 0) return;
  const A = aiAnalyze(c);
  const { enemies, front, border, interior, inWar } = A;
  const preparing = !inWar && A.staging !== null;

  // ---- Инвестиции и найм ----
  if (c.money >= 160) {
    let pool;
    if (inWar || preparing) pool = front.length ? front : border;
    else pool = border;
    if (!pool.length) pool = c.provinces.map((id) => game.provinces[id]);
    // в войне усиливаем самую угрожаемую провинцию, иначе случайную
    let targetP;
    if (inWar && front.length) {
      targetP = front.slice().sort((x, y) => (y._threat / (provPower(y) + 50)) - (x._threat / (provPower(x) + 50)))[0];
    } else {
      targetP = pool[Math.floor(Math.random() * pool.length)];
    }
    if (inWar || preparing || Math.random() < 0.65) {
      const wantTech = inWar || preparing ? 0.45 : 0.18;
      if (c.money >= 500 && Math.random() < wantTech) {
        const type = Math.random() < 0.7 ? 'tank' : 'air';
        const n = type === 'tank' ? 20 : 8;
        if (canAffordUnits(c.id, type, n)) buyUnits(c.id, targetP.id, type, n);
      } else {
        const buy = Math.min(Math.floor(c.money / 120) * 100, 500);
        if (buy >= 100) { c.money -= (buy / 100) * 120; targetP.troops += buy; }
      }
    } else if (c.money >= 300 && c.res.steel >= 30 && targetP.fort === 0 && Math.random() < 0.28) {
      c.money -= 280; c.res.steel -= 30; targetP.fort = 1;
    } else if (c.money >= 250 && targetP.economy < 8 && Math.random() < 0.3) {
      c.money -= 230; targetP.economy++;
    }
  }

  if (!inWar && !preparing) return;

  // ---- Подтягивание резервов к фронту ----
  for (const ip of interior.concat(border)) {
    if (ip.troops <= 280) continue;
    const friends = getReachableNeighbors(ip.id).map((n) => game.provinces[n.id]).filter((q) => q.ownerId === c.id && q._frontDist < ip._frontDist);
    if (!friends.length) continue;
    friends.sort((x, y) => x._frontDist - y._frontDist);
    sendTroops(ip.id, friends[0].id, 0.55);
  }

  if (!inWar) return;

  // ---- Оборона: усиливаем провинции, которым угрожает превосходящий враг ----
  for (const fp of front) {
    if (fp._threat <= provPower(fp) * 0.9) continue;
    const helpers = getReachableNeighbors(fp.id).map((n) => game.provinces[n.id])
      .filter((q) => q.ownerId === c.id && provPower(q) > 400 && q._threat < provPower(q) * 0.6)
      .sort((x, y) => provPower(y) - provPower(x));
    if (helpers.length) sendTroops(helpers[0].id, fp.id, 0.5);
  }

  // ---- Наступление ----
  const margin = 1.3 - c.aiAggression * 0.25;     // насколько нужно превосходить врага на участке
  const maxAttacks = c.aiAggression > 0.6 ? 2 : 1;
  let attacks = 0;
  const attackers = front.slice().sort((x, y) => provPower(y) - provPower(x));
  for (const bp of attackers) {
    if (attacks >= maxAttacks) break;
    const myP = provPower(bp);
    if (myP < 150) continue;
    // не оголяем провинцию: остаток должен выдержать соседей-врагов
    const spare = myP - bp._threat * 0.6;
    const ratio = Math.min(0.85, spare / myP);
    if (ratio < 0.3) continue;
    const sent = myP * ratio;
    let best = null;
    for (const { id: nbId, isSea } of getReachableNeighbors(bp.id)) {
      const nbP = game.provinces[nbId];
      if (!enemies.has(nbP.ownerId)) continue;
      const effDef = provPower(nbP) * (1 + nbP.fort * 0.45 + (nbP.isCapital ? 0.2 : 0) + (isSea ? 0.15 : 0));
      if (sent < effDef * margin) continue;
      const value = (nbP.isCapital ? 6 : 0) + nbP.economy + sent / (effDef + 1);
      if (!best || value > best.value) best = { id: nbId, value };
    }
    if (best && sendTroops(bp.id, best.id, ratio)) attacks++;
  }
}
