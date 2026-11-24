'use strict';
/* ГЕГЕМОН — Дипломатия: оценка силы, мир, союзы, пакты, планирование войн ИИ
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Принцип: каждое решение ИИ — это «оценка» (score) из нескольких причин, у каждой причина с весом и
   текстом. Порог принятия — константа. Те же оценки показываются игроку, когда ему отказывают. */

const PEACE_THRESHOLD = 0.6;   // выше — ИИ согласен на мир
const ALLY_THRESHOLD = 0.8;    // выше — ИИ согласен на союз
const PACT_THRESHOLD = 0.4;    // выше — ИИ согласен на пакт о ненападении
const NEAR_DIST = 420;         // «рядом» в координатах карты (ширина мира = 2000)
const FAR_DIST = 900;

// ---------------------------------------------------------------- индекс союзов и войн
function initDiploIndex() {
  game.allies = game.countries.map(() => new Set());
  game.wars = game.countries.map(() => new Set());
}

function rebuildDiploIndex() {
  initDiploIndex();
  for (const [key, rel] of game.relations) {
    const [a, b] = key.split(':').map(Number);
    if (rel.status === 'ally') { game.allies[a].add(b); game.allies[b].add(a); }
    else if (rel.status === 'war') { game.wars[a].add(b); game.wars[b].add(a); }
  }
}

// Единственный способ менять статус отношений (держит индексы в порядке)
function setRelStatus(a, b, status) {
  const rel = getRelation(a, b);
  if (rel.status === 'ally') { game.allies[a].delete(b); game.allies[b].delete(a); }
  if (rel.status === 'war') { game.wars[a].delete(b); game.wars[b].delete(a); }
  rel.status = status;
  if (status === 'ally') { game.allies[a].add(b); game.allies[b].add(a); }
  if (status === 'war') { game.wars[a].add(b); game.wars[b].add(a); }
  return rel;
}

function alliesOf(cid) { return [...game.allies[cid]].filter((id) => game.countries[id].alive); }
function enemiesOf(cid) { return [...game.wars[cid]].filter((id) => game.countries[id].alive); }

// ---------------------------------------------------------------- оценка силы
let dipCache = { t: 0, map: new Map() };

function dipInfo(cid) {
  const now = performance.now();
  if (now - dipCache.t > 400) dipCache = { t: now, map: new Map() };
  let v = dipCache.map.get(cid);
  if (v) return v;
  const c = game.countries[cid];
  const st = getCountryStats(cid);
  let sx = 0, sy = 0;
  const nbrs = new Set();
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    sx += p.cx; sy += p.cy;
    for (const nb of p.neighbors) { const o = game.provinces[nb].ownerId; if (o !== cid) nbrs.add(o); }
    for (const nb of p.seaNeighbors) { const o = game.provinces[nb].ownerId; if (o !== cid) nbrs.add(o); }
  }
  const n = Math.max(1, c.provinces.length);
  v = {
    army: st.army, eco: st.eco, income: st.income, provs: c.provinces.length,
    strength: st.army + st.eco * 60,
    cx: sx / n, cy: sy / n, nbrs
  };
  dipCache.map.set(cid, v);
  return v;
}

function strengthOf(cid) { return dipInfo(cid).strength; }

// Сила блока: сама страна + 70% силы союзников
function blocStrength(cid) {
  let s = strengthOf(cid);
  for (const a of alliesOf(cid)) s += strengthOf(a) * 0.7;
  return s;
}

function countryDist(a, b) {
  const A = dipInfo(a), B = dipInfo(b);
  return Math.hypot(A.cx - B.cx, A.cy - B.cy);
}
function areNeighbors(a, b) { return dipInfo(a).nbrs.has(b) || dipInfo(b).nbrs.has(a); }

// Детерминированный «настрой» пары на полгода — чтобы нельзя было спамить предложениями ради удачи
function pairNoise(a, b, salt) {
  const bucket = Math.floor(game.totalMonths / 6);
  const x = Math.sin(a * 91.7 + b * 17.3 + bucket * 5.1 + salt * 3.3) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function addReason(list, v, text) { if (Math.abs(v) >= 0.15) list.push({ v, t: text }); }
function finishScore(list, extra = 0) {
  let score = extra;
  for (const r of list) score += r.v;
  list.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  return { score, reasons: list };
}
function nm(cid) { const c = game.countries[cid]; return `${c.flag} ${c.name}`; }

// ---------------------------------------------------------------- МИР
// Оценка с точки зрения aiId: насколько ему нужен мир с enemyId. tribute — деньги, которые ему готовы заплатить.
function peaceScore(aiId, enemyId, tribute = 0) {
  const ai = game.countries[aiId], en = game.countries[enemyId];
  const rel = getRelation(aiId, enemyId);
  const myWS = aiId < enemyId ? rel.warScoreA : rel.warScoreB;
  const thWS = aiId < enemyId ? rel.warScoreB : rel.warScoreA;
  const months = game.totalMonths - rel.sinceMonth;
  const R = [];

  // 1. Соотношение сил с учётом союзников, воюющих в этой войне
  let sMe = strengthOf(aiId), sEn = strengthOf(enemyId);
  for (const a of alliesOf(aiId)) if (isAtWar(a, enemyId)) sMe += strengthOf(a) * 0.7;
  for (const a of alliesOf(enemyId)) if (isAtWar(a, aiId)) sEn += strengthOf(a) * 0.7;
  const ratio = (sEn + 1) / (sMe + 1);
  let vPow = Math.max(-2.2, Math.min(2.2, Math.log2(ratio) * 1.1));
  // Уверенность в победе тает, если сильная сторона годами не может ничего захватить
  if (vPow < 0 && myWS <= thWS) vPow *= Math.max(0.25, 1 - Math.max(0, months - 6) / 18);
  addReason(R, vPow, vPow > 0 ? `${ai.name} уступает по силам` : `${ai.name} сильнее и рассчитывает на победу`);

  // 2. Ход войны: кто больше захватил
  const vMom = Math.max(-1.5, Math.min(1.5, (thWS - myWS) * 0.45));
  addReason(R, vMom, vMom > 0 ? `${ai.name} теряет земли` : `${ai.name} наступает и берёт земли`);

  // 3. Усталость от войны
  addReason(R, Math.min(1.3, months * 0.035), 'война затянулась');

  // 4. Кризис в стране
  let crisis = 0;
  if (ai.starving) crisis += 0.7;
  if (ai.noFuel) crisis += 0.3;
  if (ai.money < 80) crisis += 0.3;
  addReason(R, crisis, 'в стране кризис (голод, нет топлива или денег)');

  // 5. Характер: упрямство агрессоров
  addReason(R, -(ai.aiAggression - 0.55) * 1.6, ai.aiAggression > 0.55 ? 'воинственный характер' : 'осторожный характер');

  // 6. Цели достигнуты
  if (myWS >= 3 || (myWS >= 2 && ratio < 1)) addReason(R, 0.6, `${ai.name} добилась своих целей и хочет закрепить успех`);

  // 7. Агрессор не отступает в первые месяцы
  if (rel.aggressor === aiId) addReason(R, -1.0 * Math.max(0, 1 - months / 6), `${ai.name} только начала эту войну`);

  // 8. Деньги за мир
  if (tribute > 0) addReason(R, Math.min(1.2, tribute / (150 + dipInfo(aiId).income * 3)), 'денежная компенсация');

  return finishScore(R);
}

// Минимальная выплата, при которой ИИ согласится на мир (или null)
function tributeNeeded(aiId, payerId, maxMoney) {
  if (peaceScore(aiId, payerId, 0).score >= PEACE_THRESHOLD) return 0;
  for (let t = 100; t <= Math.min(maxMoney, 6000); t += 100) {
    if (peaceScore(aiId, payerId, t).score >= PEACE_THRESHOLD) return t;
  }
  return null;
}

// ---------------------------------------------------------------- СОЮЗ
// Оценка с точки зрения aiId: хочет ли он союз с otherId
function allianceScore(aiId, otherId) {
  const ai = game.countries[aiId], ot = game.countries[otherId];
  const R = [];
  const hard = (text) => ({ score: -99, reasons: [{ v: -99, t: text }], blocked: true });
  const rel = getRelation(aiId, otherId);

  if (rel.status === 'war') return hard('мы в состоянии войны');
  for (const e of enemiesOf(aiId)) if (game.allies[otherId].has(e)) return hard(`${ot.name} в союзе с нашим врагом (${game.countries[e].name})`);
  for (const e of enemiesOf(otherId)) if (game.allies[aiId].has(e)) return hard(`наш союзник ${game.countries[e].name} воюет с ${ot.name}`);

  const myS = strengthOf(aiId), otS = strengthOf(otherId);
  const near = areNeighbors(aiId, otherId);
  const dist = countryDist(aiId, otherId);

  // Базовая осторожность: без причин союзов не заключают
  R.push({ v: -0.6, t: 'союз — серьёзное обязательство' });

  // Общие враги
  const common = enemiesOf(aiId).filter((e) => game.wars[otherId].has(e));
  if (common.length) addReason(R, Math.min(2.6, 1.6 + (common.length - 1) * 0.6), `общий враг: ${common.map((e) => game.countries[e].name).join(', ')}`);

  // Общая угроза: сильный сосед, которого боятся оба
  let T = null, Ts = 0;
  for (const n of dipInfo(aiId).nbrs) {
    if (n === otherId || !game.countries[n].alive || game.allies[aiId].has(n)) continue;
    const s = strengthOf(n);
    if (s > myS * 1.4 && s > Ts) { T = n; Ts = s; }
  }
  if (T !== null) {
    const sharesThreat = areNeighbors(otherId, T) || countryDist(otherId, T) < NEAR_DIST;
    if (sharesThreat) addReason(R, 1.2, `общая угроза со стороны ${game.countries[T].name}`);
    if (myS + otS > Ts * 0.8) addReason(R, 0.5, `вместе они уравновесят ${game.countries[T].name}`);
  }

  // Сила партнёра
  const r = otS / (myS + 1);
  if (r > 1) addReason(R, Math.min(0.9, (r - 1) * 0.35), `${ot.name} сильное государство`);
  else if (r < 0.4 && !common.length) addReason(R, -0.7, `${ot.name} слишком слаба — обуза, а не союзник`);

  // География
  if (near) {
    if (myS > otS * 1.8) addReason(R, -1.2, `${ot.name} — слабый сосед, проще присоединить, чем дружить`);
    else addReason(R, 0.3, 'соседи, союз прикроет границу');
  } else if (dist < NEAR_DIST) addReason(R, 0.5, 'общий регион');
  else if (dist > FAR_DIST) addReason(R, -0.8, 'слишком далеко друг от друга');

  // Объединить силы: близкие по мощи страны
  if ((near || dist < NEAR_DIST) && r > 0.5 && r < 2) addReason(R, 0.4, 'схожие по силе, выгодно объединить силы');

  // Репутация
  addReason(R, (ot.honor - 70) / 35, ot.honor >= 70 ? `${ot.name} держит слово` : `${ot.name} ненадёжный партнёр`);

  // Перегруз союзами
  const nAll = alliesOf(aiId).length;
  if (nAll >= 4) return hard('у нас уже слишком много союзников');
  if (nAll >= 1) addReason(R, -0.7 * nAll, 'у нас уже есть союзники');
  if (alliesOf(otherId).length >= 4) return hard(`у ${ot.name} уже слишком много союзников`);

  // Риск втянуться в чужие войны
  let drag = 0, dragNames = [];
  for (const e of enemiesOf(otherId)) {
    if (game.wars[aiId].has(e)) continue;
    const eb = blocStrength(e);
    const combined = myS + otS;
    drag += eb > combined * 0.9 ? -2.0 : eb > combined * 0.4 ? -0.8 : -0.2;
    dragNames.push(game.countries[e].name);
  }
  if (drag < 0) addReason(R, Math.max(-3, drag), `союз втянет в войну с ${dragNames.join(', ')}`);

  // История
  if (hasPact(aiId, otherId)) addReason(R, 0.4, 'действует пакт о ненападении');
  if (rel.lastWar !== undefined) addReason(R, -1.2 * Math.max(0, 1 - (game.totalMonths - rel.lastWar) / 24), 'недавно воевали друг с другом');

  // Лёгкая случайность настроения
  const noise = pairNoise(aiId, otherId, 1) * 0.6;
  return finishScore(R, noise);
}

// Пакт о ненападении
function pactScore(aiId, otherId) {
  const ai = game.countries[aiId], ot = game.countries[otherId];
  const R = [];
  const rel = getRelation(aiId, otherId);
  if (rel.status === 'war') return { score: -99, reasons: [{ v: -99, t: 'мы в состоянии войны' }], blocked: true };
  const myS = strengthOf(aiId), otS = strengthOf(otherId);
  R.push({ v: 0.6, t: 'мир выгоден' });
  if (otS > myS * 1.3) addReason(R, 0.8, `${ai.name} опасается сильного соседа`);
  if (myS > otS * 2 && areNeighbors(aiId, otherId) && ai.aiAggression > 0.5) addReason(R, -1.6, `${ai.name} видит в ${ot.name} лёгкую добычу`);
  if (ai.warPlan && ai.warPlan.targetId === otherId) addReason(R, -3, 'уже готовит нападение');
  addReason(R, (ot.honor - 70) / 50, ot.honor >= 70 ? 'репутация надёжна' : 'репутация подпорчена');
  if (rel.lastWar !== undefined) addReason(R, -0.6 * Math.max(0, 1 - (game.totalMonths - rel.lastWar) / 18), 'недавно воевали');
  return finishScore(R, pairNoise(aiId, otherId, 2) * 0.4);
}

// Краткая сводка для интерфейса: «Готова», «Склонна»…
function attitudeLabel(score, thr) {
  if (score >= thr) return { text: 'Согласна', cls: 'good' };
  if (score >= thr - 0.6) return { text: 'Колеблется', cls: 'mid' };
  return { text: 'Против', cls: 'bad' };
}

function reasonsText(list, n = 3) {
  return list.slice(0, n).map((r) => `${r.v > 0 ? '＋' : '－'} ${r.t}`).join('<br>');
}

// ---------------------------------------------------------------- действия
function formAlliance(a, b, silent) {
  setRelStatus(a, b, 'ally');
  const A = game.countries[a], B = game.countries[b];
  if (!silent) addNews(`🤝 ${A.flag} ${A.name} и ${B.flag} ${B.name} заключили союз`, 'ally');
}

function breakAlliance(a, b, breaker) {
  setRelStatus(a, b, 'neutral');
  if (breaker !== undefined) {
    const c = game.countries[breaker];
    c.honor = Math.max(0, c.honor - 15);
    addNews(`💔 ${nm(breaker)} разорвала союз с ${nm(breaker === a ? b : a)}`, 'war');
  }
}

function signPact(a, b, months) {
  const rel = setRelStatus(a, b, 'pact');
  rel.pactUntil = game.totalMonths + months;
}

// ---------------------------------------------------------------- предложения игроку
const pendingOffers = [];

function offerToPlayer(offer) {
  if (pendingOffers.some((o) => o.kind === offer.kind && o.fromId === offer.fromId)) return;
  pendingOffers.push(offer);
  checkOffers();
}

function checkOffers() {
  if (game.phase !== 'playing' || !pendingOffers.length) return;
  if (modalBackdrop.classList.contains('visible')) return;
  const o = pendingOffers.shift();
  const c = game.countries[o.fromId];
  if (!c.alive) { checkOffers(); return; }
  if (o.kind === 'peace' && !isAtWar(o.fromId, game.playerId)) { checkOffers(); return; }
  if (o.kind === 'ally' && getRelation(o.fromId, game.playerId).status !== 'neutral' && getRelation(o.fromId, game.playerId).status !== 'pact') { checkOffers(); return; }
  const prevSpeed = game.speed;
  game.speed = 0; updateSpeedBtn();
  const resume = () => { if (game.phase === 'playing') { game.speed = prevSpeed; updateSpeedBtn(); } checkOffers(); };
  modalBox.innerHTML = `
    <div class="modal-title">${o.kind === 'peace' ? '🕊️ Предложение мира' : '🤝 Предложение союза'}</div>
    <div class="modal-body">${c.flag} <strong>${c.name}</strong> ${o.kind === 'peace' ? 'предлагает закончить войну. Захваченные провинции останутся за теми, кто ими владеет.' : 'предлагает заключить союз.'}
      <div class="mk-name"><small>${o.why || ''}</small></div></div>
    <div class="modal-actions">
      <button class="btn" id="m-no">Отказать</button>
      <button class="btn btn-emerald" id="m-yes">Принять</button>
    </div>`;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-no').onclick = () => { closeModal(); resume(); };
  document.getElementById('m-yes').onclick = () => { closeModal(); o.onAccept(); resume(); };
}

// ---------------------------------------------------------------- МЕСЯЧНЫЙ ХОД ДИПЛОМАТИИ ИИ
function processDiplomacyMonth() {
  for (const c of game.countries) {
    if (!c.alive) continue;
    if (c.honor < 70) c.honor = Math.min(70, c.honor + 0.5);
    if (c.grudge) for (const k of Object.keys(c.grudge)) { c.grudge[k] *= 0.97; if (c.grudge[k] < 0.2) delete c.grudge[k]; }
  }
  const ais = game.countries.filter((c) => c.alive && c.id !== game.playerId);
  for (let i = ais.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ais[i], ais[j]] = [ais[j], ais[i]]; }
  for (const c of ais) {
    if (!c.alive) continue;
    aiPeace(c);
    aiAlliance(c);
    aiPact(c);
    aiWarPlan(c);
  }
  checkOffers();
}

function aiPeace(c) {
  for (const eid of enemiesOf(c.id)) {
    const rel = getRelation(c.id, eid);
    const months = game.totalMonths - rel.sinceMonth;
    if (months < 2) continue;
    const mine = peaceScore(c.id, eid);
    if (eid === game.playerId) {
      if (mine.score >= PEACE_THRESHOLD + 0.3 && game.totalMonths >= (c.offerUntil || 0)) {
        c.offerUntil = game.totalMonths + 6;
        offerToPlayer({ kind: 'peace', fromId: c.id, why: reasonsText(mine.reasons, 2), onAccept: () => signPeace(c.id, eid, 0) });
      }
      continue;
    }
    if (c.id > eid) continue; // каждую пару рассматриваем один раз
    const theirs = peaceScore(eid, c.id);
    if (mine.score >= PEACE_THRESHOLD && theirs.score >= PEACE_THRESHOLD && Math.random() < 0.6) {
      // победитель получает контрибуцию с проигравшего
      const myWS = c.id < eid ? rel.warScoreA : rel.warScoreB;
      const thWS = c.id < eid ? rel.warScoreB : rel.warScoreA;
      const diff = myWS - thWS;
      if (diff >= 2) signPeace(c.id, eid, Math.floor(Math.min(game.countries[eid].money * 0.5, 120 * diff)));
      else if (diff <= -2) signPeace(eid, c.id, Math.floor(Math.min(c.money * 0.5, 120 * -diff)));
      else signPeace(c.id, eid, 0);
    }
  }
}

function aiAlliance(c) {
  const info = dipInfo(c.id);
  const inWar = enemiesOf(c.id).length > 0;
  let threatened = false;
  const myS = info.strength;
  for (const n of info.nbrs) if (game.countries[n].alive && strengthOf(n) > myS * 1.4 && !game.allies[c.id].has(n)) { threatened = true; break; }
  const chance = 0.025 * (inWar || threatened ? 3 : 1);
  if (Math.random() > chance) return;

  const cands = [...info.nbrs].filter((id) => game.countries[id].alive);
  // плюс несколько стран «рядом», не соседей
  for (const o of game.countries) {
    if (cands.length >= 14) break;
    if (!o.alive || o.id === c.id || cands.includes(o.id)) continue;
    if (Math.random() < 0.04 && countryDist(c.id, o.id) < NEAR_DIST * 1.3) cands.push(o.id);
  }
  let best = null;
  for (const oid of cands) {
    const rel = getRelation(c.id, oid);
    if (rel.status === 'war' || rel.status === 'ally') continue;
    if ((rel.allyBlockUntil || 0) > game.totalMonths) continue;
    const mine = allianceScore(c.id, oid);
    if (mine.score >= ALLY_THRESHOLD && (!best || mine.score > best.sc.score)) best = { oid, sc: mine };
  }
  if (!best) return;
  const other = game.countries[best.oid];
  const rel = getRelation(c.id, best.oid);
  if (best.oid === game.playerId) {
    if (game.totalMonths >= (c.offerUntil || 0)) {
      c.offerUntil = game.totalMonths + 6;
      offerToPlayer({ kind: 'ally', fromId: c.id, why: reasonsText(best.sc.reasons, 2), onAccept: () => { formAlliance(c.id, game.playerId); sfx.peace(); updateHud(); refreshDrawer(); } });
    }
    return;
  }
  if (allianceScore(best.oid, c.id).score >= ALLY_THRESHOLD) formAlliance(c.id, best.oid);
  else rel.allyBlockUntil = game.totalMonths + 6;
}

function aiPact(c) {
  if (Math.random() > 0.04) return;
  const nb = [...dipInfo(c.id).nbrs].filter((id) => game.countries[id].alive && id !== game.playerId);
  if (!nb.length) return;
  const oid = nb[Math.floor(Math.random() * nb.length)];
  const rel = getRelation(c.id, oid);
  if (rel.status !== 'neutral') return;
  if (pactScore(c.id, oid).score >= PACT_THRESHOLD && pactScore(oid, c.id).score >= PACT_THRESHOLD) signPact(c.id, oid, 24);
}

// ---------------------------------------------------------------- ВОЙНА: выбор цели и подготовка
function warTargetScore(c, tid) {
  const t = game.countries[tid];
  const mine = blocStrength(c.id), theirs = blocStrength(tid);
  const ratio = mine / (theirs + 1);
  const need = 2.0 - c.aiAggression * 0.9;
  if (ratio < need) return null;
  let s = (ratio - need) * 1.2;
  const why = [`сильнее в ${ratio.toFixed(1)} раза`];

  // Претензии на исконные земли и месть
  let claims = 0, eco = 0;
  for (const pid of t.provinces) {
    const p = game.provinces[pid];
    const touches = getReachableNeighbors(pid).some((n) => game.provinces[n.id].ownerId === c.id);
    if (!touches) continue;
    eco += p.economy;
    if (p.origOwnerId === c.id) claims++;
  }
  if (eco === 0) return null; // нет общей линии фронта
  s += Math.min(3, claims) * 1.2;
  s += Math.min(1.5, eco / 8);
  const grudge = c.grudge ? (c.grudge[tid] || 0) : 0;
  s += Math.min(2, grudge * 0.5);
  // Добивание ослабленных
  s += Math.min(1.2, enemiesOf(tid).length * 0.4);
  if (t.starving) s += 0.5;
  // Не нападать на друзей друзей
  for (const a of alliesOf(c.id)) if (game.allies[a].has(tid)) return null;
  return { score: s, ratio, claims };
}

function aiWarPlan(c) {
  if (!c.alive || game.totalMonths < 3) return;
  const warsNow = enemiesOf(c.id).length;
  if (c.warPlan) {
    const t = game.countries[c.warPlan.targetId];
    const rel = getRelation(c.id, c.warPlan.targetId);
    if (!t.alive || rel.status === 'war' || rel.status === 'ally' || rel.status === 'pact') { c.warPlan = null; return; }
    if (game.totalMonths < c.warPlan.readyMonth) return;
    const sc = warTargetScore(c, c.warPlan.targetId);
    if (sc && sc.score >= 0.8 && !c.starving && warsNow < 2) declareWar(c.id, c.warPlan.targetId);
    c.warPlan = null;
    return;
  }
  if (warsNow >= 1) return;                              // сначала закончить текущую войну
  if (c.starving || c.money < 300) return;
  if (Math.random() > 0.02 + c.aiAggression * 0.05) return;
  let best = null;
  for (const tid of dipInfo(c.id).nbrs) {
    const t = game.countries[tid];
    if (!t.alive) continue;
    const rel = getRelation(c.id, tid);
    if (rel.status !== 'neutral') continue;
    const sc = warTargetScore(c, tid);
    if (sc && sc.score >= 0.8 && (!best || sc.score > best.sc.score)) best = { tid, sc };
  }
  if (best) c.warPlan = { targetId: best.tid, readyMonth: game.totalMonths + 3 + Math.floor(Math.random() * 4) };
}
