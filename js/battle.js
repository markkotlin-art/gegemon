'use strict';
/* ГЕГЕМОН — Стратегическое время и затяжные бои
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Время идёт по дням: 1 игровой день = DAY_SECONDS реальных секунд на скорости 1x (месяц = 30 дней).
   Армия, дошедшая до вражеской провинции, не решает исход сразу, а начинает бой (game.fights).
   Каждый день стороны теряют силу пропорционально силе противника (закон Ланчестера) со случайным разбросом.
   Сторона «ломается», когда потеряла большую часть пиковой силы или стала слишком слабее врага.
   Подобрано на модели: равные силы — ~29 дней (~7 мин на 1x), ×1,5 — ~16, ×2 — ~11, ×4 и больше — ~4 дня.

   Защитник — сам гарнизон провинции: всё, что приходит в провинцию (подкрепления, найм), сразу воюет.
   Атакующий — армия боя: новые марши той же страны в эту провинцию вливаются в бой. */

const DAY_SECONDS = 15;              // реальных секунд в игровом дне на 1x
const SPEED_STEPS = [1, 2, 5, 20];   // скорости игры (⏸ — отдельно)
const FIGHT_RATE = 0.03;             // доля силы врага, которую сторона «выбивает» за день
const FIGHT_MIN_DAYS = 4;            // раньше этого бой не кончается (если защитник не символический)
const FIGHT_MAX_DAYS = 75;           // затянувшийся бой — атакующий отходит
const FIGHT_BREAK_OWN = 0.4;         // сторона ломается, сохранив меньше 40% пиковой силы…
const FIGHT_BREAK_RATIO = 0.2;       // …или став слабее врага впятеро
const RETREAT_LOSS = 0.15;           // потери при отступлении
const MARCH_LAND = { base: 3, per: 10, min: 4, max: 12 };   // дни = base + расстояние/per (пехота по суше)
const MARCH_SEA = { base: 4, per: 8, min: 5, max: 16 };     // морем дольше
const MOBILE_DAYS_BONUS = 0.5;       // техника и авиация идут до 2 раз быстрее
const AI_DECIDE_CHANCE = 0.2;        // военные решения ИИ: в среднем раз в 5 дней
const AI_ATTACK_CHANCE = 0.1;        // доля военных решений, в которых ИИ начинает новое наступление (~0,6 в месяц, как в прежнем темпе)
const AI_ECON_CHANCE = 0.015;        // найм и стройка ИИ: ~раз в 2 месяца, как в прежнем темпе (иначе ИИ тратит всё на армию)
const AUTOSAVE_DAYS = 10;            // автосохранение раз в 10 игровых дней (~2,5 мин на 1x)

// Автопауза (настраивается в меню ☰, хранится в браузере)
const AUTOPAUSE_KEY = 'gegemon.autopause';
const autoPause = { attacked: true, fightEnd: true, war: true };
try { Object.assign(autoPause, JSON.parse(localStorage.getItem(AUTOPAUSE_KEY) || '{}')); } catch (_) {}
function saveAutoPause() { try { localStorage.setItem(AUTOPAUSE_KEY, JSON.stringify(autoPause)); } catch (_) {} }

function pauseGame(reason) {
  if (game.phase !== 'playing' || game.speed === 0) return;
  game.speed = 0;
  updateSpeedBtn();
  if (reason) pushToast(`⏸ Пауза: ${reason}`, 'war');
}

// ---------------------------------------------------------------- переходы
// Сколько дней армия идёт от провинции к провинции
function marchDays(fromP, toP, army, isSea) {
  const dist = Math.hypot(toP.cx - fromP.cx, toP.cy - fromP.cy);
  const pw = rawPower(army) || 1;
  const mobileShare = ((army.tanks || 0) * TANK_POWER + (army.air || 0) * AIR_POWER) / pw;
  const k = 1 - MOBILE_DAYS_BONUS * mobileShare;
  const r = isSea ? MARCH_SEA : MARCH_LAND;
  const base = Math.max(r.min, Math.min(r.max, r.base + dist / r.per));
  return Math.max(2, base * k);
}

function marchDaysLeft(m) {
  return Math.max(0, Math.ceil((1 - m.progress) * m.duration));
}

// ---------------------------------------------------------------- бои
function fightsAt(pid) {
  return game.fights.filter((f) => f.pid === pid);
}

function fightById(id) {
  return game.fights.find((f) => f.id === id) || null;
}

// Бонус обороны: форт (авиация атакующего его частично обходит), столица, высадка с моря
function fightDefBonus(f) {
  const p = game.provinces[f.pid];
  const atkRaw = armyPower(f.army, f.owner);
  const airShare = atkRaw > 0 ? ((f.army.air || 0) * AIR_POWER * (game.countries[f.owner].noFuel ? NO_FUEL_MULT : 1)) / atkRaw : 0;
  return 1 + p.fort * 0.45 * (1 - AIR_FORT_PIERCE * airShare) + (p.isCapital ? 0.2 : 0) + (f.isSea ? 0.15 : 0);
}

// Действующие силы сторон
function fightPowers(f) {
  const p = game.provinces[f.pid];
  const A = armyPower(f.army, f.owner);
  const D = armyPower(p, p.ownerId) * fightDefBonus(f);
  return { A, D };
}

// Прогноз без случайности: кто сломается и примерно через сколько дней
function fightForecast(f) {
  let { A, D } = fightPowers(f);
  let pA = Math.max(f.peakA, A), pD = Math.max(f.peakD, D);
  for (let d = 1; d <= 120; d++) {
    const lA = FIGHT_RATE * D, lD = FIGHT_RATE * A;
    A = Math.max(0, A - lA); D = Math.max(0, D - lD);
    if (f.day + d < fightMinDays(f)) continue;
    const dBreak = D < pD * FIGHT_BREAK_OWN || D < A * FIGHT_BREAK_RATIO;
    const aBreak = A < pA * FIGHT_BREAK_OWN || A < D * FIGHT_BREAK_RATIO;
    if (dBreak || aBreak) return { winner: dBreak && (!aBreak || D / pD <= A / pA) ? 'atk' : 'def', days: d };
    if (f.day + d >= FIGHT_MAX_DAYS) return { winner: 'def', days: d };
  }
  return { winner: 'def', days: 120 };
}

function fightMinDays(f) {
  const p = game.provinces[f.pid];
  // символический гарнизон сдаётся почти сразу
  return armyPower(p, p.ownerId) < Math.max(20, armyPower(f.army, f.owner) * 0.05) ? 1 : FIGHT_MIN_DAYS;
}

// Армия дошла до вражеской провинции (зовётся из resolveMarch)
function startFight(m) {
  const p = game.provinces[m.toId];
  const exist = game.fights.find((f) => f.pid === m.toId && f.owner === m.ownerId);
  if (exist) {
    addArmy(exist.army, m);
    if (m.ownerId === game.playerId) pushToast(`➕ Подкрепление вступило в бой за ${p.name}`, 'good');
    return exist;
  }
  const f = {
    id: game.nextFightId++,
    pid: m.toId,
    owner: m.ownerId,
    fromId: m.fromId,
    isSea: !!m.isSea,
    army: armyOf(m),
    day: 0,
    peakA: 0,
    peakD: 0,
    lostA: emptyArmy(),
    lostD: emptyArmy(),
    lastA: 0,
    lastD: 0
  };
  const pw = fightPowers(f);
  f.peakA = pw.A; f.peakD = pw.D;
  game.fights.push(f);

  const atk = game.countries[m.ownerId];
  if (p.ownerId === game.playerId) {
    sfx.battle();
    pushToast(`⚔️ ${atk.flag} ${atk.name} атакует ${p.name}!`, 'war');
    if (autoPause.attacked) pauseGame(`враг атакует ${p.name}`);
  } else if (m.ownerId === game.playerId) {
    sfx.battle();
    pushToast(`⚔️ Начался бой за ${p.name}`, 'war');
  }
  return f;
}

// Потери: доля lossFrac армии army уходит в lost
function applyLoss(army, lossFrac, lost) {
  const keep = scaleArmy(army, 1 - lossFrac);
  lost.troops += (army.troops || 0) - keep.troops;
  lost.tanks += (army.tanks || 0) - keep.tanks;
  lost.air += (army.air || 0) - keep.air;
  army.troops = keep.troops; army.tanks = keep.tanks; army.air = keep.air;
}

// Возвращает армию атакующего домой (или в ближайшую свою провинцию); без пути — армия распускается
function sendFightArmyHome(f, extraLoss) {
  const army = extraLoss ? scaleArmy(f.army, 1 - extraLoss) : armyOf(f.army);
  if (rawPower(army) < 1) return;
  const p = game.provinces[f.pid];
  let home = game.provinces[f.fromId];
  if (!home || home.ownerId !== f.owner || !canReach(home.id, p.id)) {
    home = null;
    for (const { id } of getReachableNeighbors(p.id)) {
      const q = game.provinces[id];
      if (q.ownerId === f.owner && (!home || rawPower(q) > rawPower(home))) home = q;
    }
  }
  if (!home) return;
  const isSea = !p.neighbors.has(home.id);
  game.marches.push({
    ownerId: f.owner, fromId: p.id, toId: home.id,
    troops: army.troops, tanks: army.tanks, air: army.air,
    isAttack: false, isSea, progress: 0, duration: marchDays(p, home, army, isSea)
  });
}

// Остатки разбитого гарнизона уходят в соседнюю свою провинцию
function evacuateGarrison(p, frac) {
  const owner = p.ownerId;
  let best = null;
  for (const { id } of getReachableNeighbors(p.id)) {
    const q = game.provinces[id];
    if (q.ownerId === owner && !game.fights.some((f) => f.pid === q.id) && (!best || rawPower(q) > rawPower(best))) best = q;
  }
  if (!best) return;
  const out = scaleArmy(p, frac);
  if (rawPower(out) < 5) return;
  p.troops -= out.troops; p.tanks -= out.tanks; p.air -= out.air;
  const isSea = !p.neighbors.has(best.id);
  game.marches.push({
    ownerId: owner, fromId: p.id, toId: best.id,
    troops: out.troops, tanks: out.tanks, air: out.air,
    isAttack: false, isSea, progress: 0, duration: marchDays(p, best, out, isSea)
  });
}

function fightFx(f, captured) {
  const p = game.provinces[f.pid];
  const fromP = game.provinces[f.fromId];
  game.battles.push({
    x: fromP ? fromP.cx * 0.32 + p.cx * 0.68 : p.cx,
    y: fromP ? fromP.cy * 0.32 + p.cy * 0.68 : p.cy,
    atkLoss: Math.floor(rawPower(f.lostA)), defLoss: Math.floor(rawPower(f.lostD)), captured,
    life: 2.2, maxLife: 2.2
  });
}

function removeFight(f) {
  const i = game.fights.indexOf(f);
  if (i !== -1) game.fights.splice(i, 1);
}

function fightEndedForPlayer(f, text, cls) {
  const p = game.provinces[f.pid];
  if (f.owner !== game.playerId && p.ownerId !== game.playerId && f.defOwner !== game.playerId) return;
  pushToast(text, cls);
  if (autoPause.fightEnd) pauseGame(text.replace(/^[^\wА-Яа-яЁё]+/, ''));
}

// Защитник сломан: провинция переходит атакующему
function fightCaptured(f) {
  const p = game.provinces[f.pid];
  const defOwner = p.ownerId;
  f.defOwner = defOwner;
  evacuateGarrison(p, 0.5);
  removeFight(f);
  fightFx(f, true);
  const surv = armyOf(f.army);
  surv.troops = Math.max(8, surv.troops);
  if (f.owner === game.playerId || defOwner === game.playerId) sfx.battle();
  transferProvince(f.pid, f.owner, surv);
  if (f.owner === game.playerId) fightEndedForPlayer(f, `🚩 ${p.name} взята! Потери: ${armyBreakdownText(f.lostA)}`, 'good');
  else if (defOwner === game.playerId) fightEndedForPlayer(f, `💔 ${p.name} потеряна`, 'war');
}

// Атакующий сломан: остатки отходят
function fightRepelled(f, why) {
  const p = game.provinces[f.pid];
  removeFight(f);
  fightFx(f, false);
  sendFightArmyHome(f, RETREAT_LOSS);
  if (f.owner === game.playerId) fightEndedForPlayer(f, `🛡 Атака на ${p.name} отбита${why ? ' (' + why + ')' : ''}. Остатки отходят.`, 'war');
  else if (p.ownerId === game.playerId) fightEndedForPlayer(f, `🛡 ${p.name} выстояла! Враг отступает.`, 'good');
}

// Отступление по приказу (игрок или ИИ)
function retreatFight(f) {
  if (!fightById(f.id)) return;
  removeFight(f);
  sendFightArmyHome(f, RETREAT_LOSS);
  const p = game.provinces[f.pid];
  if (f.owner === game.playerId) pushToast(`↩️ Войска отходят от ${p.name}`, 'war');
  else if (p.ownerId === game.playerId) pushToast(`↩️ Враг отступил от ${p.name}`, 'good');
}

// Один день всех боёв
function processFightsDay() {
  for (const f of game.fights.slice()) {
    if (!fightById(f.id)) continue;
    const p = game.provinces[f.pid];
    // провинция уже наша — армия входит в гарнизон
    if (p.ownerId === f.owner) { addArmy(p, f.army); removeFight(f); continue; }
    // мир заключён или страна исчезла — армия возвращается
    if (!game.countries[f.owner].alive || !isAtWar(f.owner, p.ownerId)) { removeFight(f); sendFightArmyHome(f, 0); continue; }
    if (rawPower(f.army) < 1) { removeFight(f); continue; }

    const before = fightPowers(f);
    f.peakA = Math.max(f.peakA, before.A);
    f.peakD = Math.max(f.peakD, before.D);
    // потери за день с разбросом ±25%
    const lossA = Math.min(before.A, FIGHT_RATE * before.D * (0.75 + Math.random() * 0.5));
    const lossD = Math.min(before.D, FIGHT_RATE * before.A * (0.75 + Math.random() * 0.5));
    applyLoss(f.army, before.A > 0 ? lossA / before.A : 1, f.lostA);
    applyLoss(p, before.D > 0 ? lossD / before.D : 1, f.lostD);
    p.troops = Math.max(0, p.troops);
    f.lastA = lossA; f.lastD = lossD;
    f.day++;

    const { A, D } = fightPowers(f);
    if (f.day < fightMinDays(f)) continue;
    const dBreak = D < f.peakD * FIGHT_BREAK_OWN || D < A * FIGHT_BREAK_RATIO || D < 1;
    const aBreak = A < f.peakA * FIGHT_BREAK_OWN || A < D * FIGHT_BREAK_RATIO || A < 1;
    if (dBreak && (!aBreak || D / f.peakD <= A / f.peakA)) fightCaptured(f);
    else if (aBreak) fightRepelled(f);
    else if (f.day >= FIGHT_MAX_DAYS) fightRepelled(f, 'бой затянулся');
  }
}

// ---------------------------------------------------------------- ИИ в бою
function aiManageFights(c) {
  for (const f of game.fights.slice()) {
    if (f.owner !== c.id) continue;
    const { A, D } = fightPowers(f);
    const fc = fightForecast(f);
    // проигрываем и спасать нечем — отходим, пока армия цела
    if (fc.winner === 'def' && A < D * 0.6 && f.day >= 3) {
      const reserve = getReachableNeighbors(f.pid).reduce((s, { id }) => {
        const q = game.provinces[id];
        return q.ownerId === c.id ? s + rawPower(q) * 0.5 : s;
      }, 0);
      if (A + reserve < D * 0.9) { retreatFight(f); continue; }
    }
    // близко к перелому — подбрасываем резерв из соседних провинций
    if (fc.winner === 'def' || fc.days > 15) {
      for (const { id } of getReachableNeighbors(f.pid)) {
        const q = game.provinces[id];
        if (q.ownerId !== c.id || game.fights.some((x) => x.pid === q.id) || rawPower(q) < 300) continue;
        if ((q._threat || 0) > rawPower(q) * 0.5) continue;
        sendTroops(q.id, f.pid, 0.4);
        break;
      }
    }
  }
  // свои провинции под ударом — подкрепляем гарнизон
  for (const f of game.fights) {
    const p = game.provinces[f.pid];
    if (p.ownerId !== c.id) continue;
    const fc = fightForecast(f);
    if (fc.winner !== 'atk') continue;
    for (const { id } of getReachableNeighbors(f.pid)) {
      const q = game.provinces[id];
      if (q.ownerId !== c.id || game.fights.some((x) => x.pid === q.id) || rawPower(q) < 200) continue;
      sendTroops(q.id, f.pid, 0.5);
      break;
    }
  }
}

function attackingFightsOf(cid) {
  let n = 0;
  for (const f of game.fights) if (f.owner === cid) n++;
  for (const m of game.marches) if (m.ownerId === cid && m.isAttack) n++;
  return n;
}

// ---------------------------------------------------------------- день
// Ежедневная экономика: доход, ресурсы и призыв по 1/30 месячного
function processEconomyDay(c, st) {
  c._mAcc = (c._mAcc || 0) + st.income / 30;
  const whole = Math.floor(c._mAcc);
  c.money += whole; c._mAcc -= whole;
  const flow = countryResFlow(c.id);
  const cap = resCap(c);
  for (const k of RES_KEYS) c.res[k] = Math.min(cap, c.res[k] + flow.prod[k] / 30);
  c.res.food -= flow.use.food / 30;
  c.res.fuel -= flow.use.fuel / 30;
  updateSupplyFlags(c);   // голод / нет топлива — сразу, запас не уходит в минус
  if (!c.starving) {
    for (const pid of c.provinces) {
      const p = game.provinces[pid];
      p._gAcc = (p._gAcc || 0) + provDraftGrowth(p) / 30;
      const g = Math.floor(p._gAcc);
      p.troops += g; p._gAcc -= g;
    }
  }
}

function processDay() {
  game.totalDays = (game.totalDays || 0) + 1;
  processFightsDay();
  if (scenarioActive()) { processConstructionDay(); processWorldOrderDay(); }
  for (const c of game.countries) {
    if (!c.alive) continue;
    processEconomyDay(c, getCountryStats(c.id));
  }
  // ИИ: военные решения в среднем раз в 5 дней, экономические — примерно раз в 2 месяца (в войне вдвое чаще)
  for (const c of game.countries) {
    if (!c.alive || c.id === game.playerId) continue;
    const mil = Math.random() < AI_DECIDE_CHANCE;
    const econ = Math.random() < AI_ECON_CHANCE * (enemiesOf(c.id).length || c.warPlan ? 2 : 1);
    if (mil || econ) runAIForCountry(c, econ, mil);
  }
  if (game.totalDays % AUTOSAVE_DAYS === 0) saveGame(true);
  updateHud();
  refreshDrawerIfFight();
}

// Панель провинции с боем обновляем каждый день, чтобы цифры шли вживую
function refreshDrawerIfFight() {
  const pid = game.selectedProvId;
  if (pid && game.fights.some((f) => f.pid === pid)) refreshDrawer();
}

// ---------------------------------------------------------------- отрисовка
function drawFights(z) {
  for (const f of game.fights) {
    const p = game.provinces[f.pid];
    if (!pointVisible(p.cx, p.cy, 60 / z)) continue;
    const fromP = game.provinces[f.fromId];
    const { A, D } = fightPowers(f);
    const share = A + D > 0 ? A / (A + D) : 0.5;
    const mine = f.owner === game.playerId, ours = p.ownerId === game.playerId;
    const atkCol = mine ? '#ef4444' : '#fb7185';
    ctx.save();

    // линия наступления
    if (fromP) {
      ctx.strokeStyle = atkCol;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2.2 / z;
      ctx.setLineDash([3 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(fromP.cx, fromP.cy);
      ctx.lineTo(p.cx, p.cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // значок боя — под плашкой гарнизона, чтобы не закрывать её
    const oy = p.cy + 17 / z;
    // пульсирующее кольцо
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 4 + f.id);
    ctx.strokeStyle = mine || ours ? '#fde047' : 'rgba(248, 113, 113, 0.85)';
    ctx.lineWidth = (1.6 + pulse) / z;
    ctx.beginPath();
    ctx.arc(p.cx, oy, (10 + pulse * 3) / z, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `${13 / z}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚔️', p.cx, oy);

    // полоска соотношения сил: слева атакующий, справа защитник
    const w = 46 / z, h = 6 / z, x = p.cx - w / 2, y = oy + 12 / z;
    ctx.fillStyle = 'rgba(9, 15, 26, 0.9)';
    drawRoundRect(ctx, x - 1.5 / z, y - 1.5 / z, w + 3 / z, h + 3 / z, 2.5 / z);
    ctx.fill();
    ctx.fillStyle = atkCol;
    ctx.fillRect(x, y, w * share, h);
    ctx.fillStyle = ours ? '#34d399' : '#60a5fa';
    ctx.fillRect(x + w * share, y, w * (1 - share), h);

    ctx.font = `800 ${8.5 / z}px "Inter", sans-serif`;
    ctx.lineWidth = 2.4 / z;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const lbl = `день ${f.day}`;
    ctx.strokeText(lbl, p.cx, y + h + 7 / z);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(lbl, p.cx, y + h + 7 / z);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- панель боя (в панели провинции)
function fightPanelHtml(pid) {
  const list = fightsAt(pid);
  if (!list.length) return '';
  const p = game.provinces[pid];
  const def = game.countries[p.ownerId];
  return list.map((f) => {
    const atk = game.countries[f.owner];
    const { A, D } = fightPowers(f);
    const share = A + D > 0 ? A / (A + D) : 0.5;
    const fc = fightForecast(f);
    const mine = f.owner === game.playerId, ours = p.ownerId === game.playerId;
    const ratio = D > 0 ? A / D : 99;
    const ratioTxt = ratio >= 1 ? `перевес атакующих ×${ratio.toFixed(1)}` : `перевес обороны ×${(1 / Math.max(ratio, 0.01)).toFixed(1)}`;
    const fcTxt = fc.winner === 'atk' ? `провинция падёт примерно через ${fc.days} дн.` : `атака выдохнется примерно через ${fc.days} дн.`;
    const canHelp = (mine || ours) && reinforceSources(f, mine ? f.owner : p.ownerId).length > 0;
    return `
      <div class="fight-box">
        <div class="fight-head">⚔️ Бой • день ${f.day} <span>${ratioTxt}</span></div>
        <div class="fight-sides">
          <div class="fs atk"><b>${atk.flag} ${atk.name}</b><small>${armyBreakdownText(f.army)}</small><small>потери ${armyBreakdownText(f.lostA)}</small></div>
          <div class="fs def"><b>${def.flag} ${def.name}</b><small>${armyBreakdownText(p)}${p.fort ? ` • 🛡${p.fort}` : ''}</small><small>потери ${armyBreakdownText(f.lostD)}</small></div>
        </div>
        <div class="fight-bar"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
        <div class="fight-fc ${(fc.winner === 'atk') === mine || (fc.winner === 'def' && ours) ? 'good' : 'bad'}">Прогноз: ${fcTxt}</div>
        ${mine || ours ? `<div class="fight-btns">
          ${canHelp ? `<button class="btn btn-sm btn-sky" data-fight-help="${f.id}">➕ Подкрепить из соседних (${game.sendPercent}%)</button>` : ''}
          ${mine ? `<button class="btn btn-sm btn-red" data-fight-retreat="${f.id}">↩️ Отступить (−${Math.round(RETREAT_LOSS * 100)}%)</button>` : ''}
        </div>` : ''}
      </div>`;
  }).join('');
}

// Свои соседние провинции, из которых можно послать подкрепление в бой
function reinforceSources(f, side) {
  const out = [];
  for (const { id } of getReachableNeighbors(f.pid)) {
    const q = game.provinces[id];
    if (q.ownerId !== side || game.fights.some((x) => x.pid === q.id)) continue;
    if (rawPower(scaleArmy(q, game.sendPercent / 100)) >= 10) out.push(q);
  }
  return out;
}

function bindFightPanel(root) {
  root.querySelectorAll('[data-fight-retreat]').forEach((b) => {
    b.onclick = () => { const f = fightById(Number(b.dataset.fightRetreat)); if (f) { retreatFight(f); refreshDrawer(); } };
  });
  root.querySelectorAll('[data-fight-help]').forEach((b) => {
    b.onclick = () => {
      const f = fightById(Number(b.dataset.fightHelp));
      if (!f) return;
      const p = game.provinces[f.pid];
      const side = f.owner === game.playerId ? f.owner : p.ownerId;
      let sent = 0;
      for (const q of reinforceSources(f, side)) if (sendTroops(q.id, f.pid, game.sendPercent / 100)) sent++;
      pushToast(sent ? `➕ Подкрепление идёт из ${sent} пров.` : 'Некого послать', sent ? 'good' : 'war');
      refreshDrawer();
    };
  });
}

// Длина игрового дня в реальном времени — для подсказок
function daysToRealText(days) {
  const sec = days * DAY_SECONDS / Math.max(1, game.speed || 1);
  return sec < 90 ? `~${Math.round(sec)} сек` : `~${Math.round(sec / 60)} мин`;
}
