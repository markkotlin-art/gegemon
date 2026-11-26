'use strict';
/* ГЕГЕМОН — Экономика, войны, бои, дипломатия, капитуляция
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 8. ЭКОНОМИКА, ВОЙНА, БОИ, ДИПЛОМАТИЯ И КАПИТУЛЯЦИЯ
// -----------------------------------------------------------------------
function getCountryStats(cid) {
  const c = game.countries[cid];
  let eco = 0, manpower = 0;
  const units = emptyArmy();
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    addArmy(units, p);
    eco += p.economy;
    manpower += provDraftGrowth(p);
  }
  for (const m of game.marches) {
    if (m.ownerId === cid) addArmy(units, m);
  }
  // В «Мире 2010» доход считается от ВВП, торговли и общих рынков (geoeconomy.js)
  let income = Math.round(28 + eco * 13);
  if (scenarioActive() && game.incK) income = scenarioIncome(c);
  return {
    army: Math.floor(rawPower(units)),
    units,
    eco,
    provCount: c.provinces.length,
    income,
    manpower: c.starving ? 0 : manpower
  };
}

function getWorldPct(cid) {
  const total = game.provinces.length - 1;
  return total > 0 ? (game.countries[cid].provinces.length / total) * 100 : 0;
}

function getReachableNeighbors(pid) {
  const p = game.provinces[pid];
  const out = [];
  for (const nb of p.neighbors) out.push({ id: nb, isSea: false });
  for (const nb of p.seaNeighbors) out.push({ id: nb, isSea: true });
  return out;
}

function canReach(a, b) {
  const p = game.provinces[a];
  return p.neighbors.has(b) || p.seaNeighbors.has(b);
}

function countriesShareBorder(a, b) {
  for (const pid of game.countries[a].provinces) {
    const p = game.provinces[pid];
    for (const nb of p.neighbors) if (game.provinces[nb].ownerId === b) return true;
    for (const nb of p.seaNeighbors) if (game.provinces[nb].ownerId === b) return true;
  }
  return false;
}

function pushToast(text, cls = '') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.32s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 340);
  }, 3000);
}

function addNews(text, kind = '', fx = null, fy = null) {
  const dateStr = `${MONTHS_RU[game.month]} ${game.year}`;
  game.events.unshift({ dateStr, text, kind, fx, fy });
  if (game.events.length > 40) game.events.pop();
  const body = document.getElementById('news-body');
  body.innerHTML = '';
  for (let i = 0; i < Math.min(20, game.events.length); i++) {
    const ev = game.events[i];
    const div = document.createElement('div');
    div.className = `news-item ${ev.kind}`;
    div.innerHTML = `<span class="news-date">${ev.dateStr}</span>${ev.text}`;
    if (ev.fx !== null) {
      div.addEventListener('click', () => focusCamera(ev.fx, ev.fy, Math.max(game.cam.zoom, 2.0)));
    }
    body.appendChild(div);
  }
}

// joined = страна вступила в чужую войну по союзу (агрессором она не считается)
function declareWar(atkId, defId, silent = false, joined = false) {
  if (atkId === defId) return;
  const cA = game.countries[atkId], cB = game.countries[defId];
  if (!cA.alive || !cB.alive || isAtWar(atkId, defId)) return;

  const rel = setRelStatus(atkId, defId, 'war');
  rel.sinceMonth = game.totalMonths;
  rel.warScoreA = 0;
  rel.warScoreB = 0;
  rel.aggressor = joined ? null : atkId;
  if (cA.warPlan && cA.warPlan.targetId === defId) cA.warPlan = null;

  // Нападение на заметно более слабого портит репутацию
  if (!joined && strengthOf(defId) < strengthOf(atkId) * 0.4) cA.honor = Math.max(0, cA.honor - 3);

  if (!silent && (atkId === game.playerId || defId === game.playerId)) {
    sfx.war();
    pushToast(`⚔️ ВОЙНА: ${cA.flag} ${cA.name} против ${cB.flag} ${cB.name}!`, 'war');
    if (defId === game.playerId && autoPause.war) pauseGame(`${cA.name} объявила вам войну`);
  }
  const cap = game.provinces[cB.capitalProvId || cB.provinces[0]];
  addNews(`⚔️ ${cA.flag} ${cA.name} объявила войну ${cB.flag} ${cB.name}`, 'war', cap?.cx ?? null, cap?.cy ?? null);

  if (scenarioActive()) onWarDeclared(atkId, defId, joined);
  callAllies(atkId, defId);
  refreshDrawer();
}

// Союзники решают, вступать ли в войну. Игрок вступает автоматически; ИИ — по обстановке и репутации.
function callAllies(atkId, defId) {
  for (const o of game.countries) {
    if (!o.alive || o.id === atkId || o.id === defId) continue;
    const allyDef = game.allies[o.id].has(defId), allyAtk = game.allies[o.id].has(atkId);
    if (allyDef === allyAtk) continue;               // не союзник или союзник обеих сторон
    const side = allyDef ? defId : atkId;
    const foe = allyDef ? atkId : defId;
    if (isAtWar(o.id, foe)) continue;

    // Военный блок (НАТО, ОДКБ, оборонные договоры): обязателен только для защиты жертвы нападения
    const bloc = sharedMilBloc(o.id, side);
    if (bloc) {
      const startedBy = getRelation(atkId, defId).aggressor;
      if (allyDef && startedBy === atkId) {
        // нападение на члена блока — коллективная оборона
        let join = o.id === game.playerId;
        if (!join) {
          let p = 0.88 + (o.honor - 70) / 200;
          if (enemiesOf(o.id).length >= 2) p -= 0.3;
          join = Math.random() < p;
          if (!join) {
            o.honor = Math.max(0, o.honor - 10);
            addNews(`🫥 ${nm(o.id)} не выполнила обязательства ${blocGen(bloc)} перед ${nm(side)}`, 'war');
          }
        }
        if (join) declareWar(o.id, foe, true, true);
      } else if (o.id === game.playerId) {
        if (allyAtk && startedBy === atkId) pushToast(`${nm(side)} сама напала на ${nm(foe)}: это не оборона, обязательства ${blocGen(bloc)} не действуют.`);
      } else if (allyAtk && startedBy === atkId && Math.random() < 0.04) {
        declareWar(o.id, foe, true, true);   // «коалиция желающих» — только к исходному нападению, без цепной реакции
      }
      continue;
    }

    let join = o.id === game.playerId;
    // страна, уже воюющая на двух фронтах, не вступает в третью войну (кроме обороны союзника-жертвы)
    const busy = o.id !== game.playerId && enemiesOf(o.id).length >= 2;
    if (!join) {
      let p;
      if (allyDef) {
        p = 0.6 + (o.honor - 50) / 100;
        if (strengthOf(foe) > (strengthOf(side) + strengthOf(o.id)) * 1.8) p -= 0.35; // положение безнадёжное
      } else {
        p = 0.25 + (o.honor - 50) / 200 + (strengthOf(side) > strengthOf(foe) * 1.5 ? 0.35 : 0);
        if (strengthOf(foe) > (strengthOf(side) + strengthOf(o.id)) * 1.2) p -= 0.25;
      }
      if (busy) p -= 0.4;
      join = Math.random() < p;
      if (!join && allyDef) {
        // Не пришла на помощь — союз рушится
        breakAlliance(o.id, side);
        o.honor = Math.max(0, o.honor - 8);
        addNews(`💔 ${nm(o.id)} не пришла на помощь ${nm(side)}, союз распался`, 'war');
      }
    }
    if (join) declareWar(o.id, foe, true, true);
  }
}

function signPeace(a, b, reparationsToA = 0) {
  const rel = getRelation(a, b);
  if (rel.status !== 'war') return;
  setRelStatus(a, b, 'pact');
  if (scenarioActive()) invalidateIncome(a, b);   // после войны снова работают курорты
  rel.pactUntil = game.totalMonths + 12;
  rel.lastWar = game.totalMonths;

  const cA = game.countries[a], cB = game.countries[b];
  if (reparationsToA > 0) {
    const paid = Math.min(Math.floor(cB.money), reparationsToA);
    cB.money -= paid;
    cA.money += paid;
  }

  // Вступившие по союзу страны выходят из войны вместе с главным участником, если не воевали всерьёз
  endJoinedWars(a, b);
  endJoinedWars(b, a);

  // Отзываем марши между бывшими врагами
  for (let i = game.marches.length - 1; i >= 0; i--) {
    const m = game.marches[i];
    const tOwner = game.provinces[m.toId].ownerId;
    if ((m.ownerId === a && tOwner === b) || (m.ownerId === b && tOwner === a)) {
      if (game.provinces[m.fromId].ownerId === m.ownerId) addArmy(game.provinces[m.fromId], m);
      game.marches.splice(i, 1);
    }
  }

  if (a === game.playerId || b === game.playerId) {
    sfx.peace();
    pushToast(`🕊️ Мир подписан. Захваченные земли закреплены за владельцами.`, 'good');
  }
  addNews(`🕊️ ${cA.flag} ${cA.name} и ${cB.flag} ${cB.name} подписали мир`, 'peace');
  updateHud();
  refreshDrawer();
}

// survivors — армия-победитель { troops, tanks, air } (допускается просто число пехоты)
function transferProvince(pid, newOwnerId, survivors) {
  const p = game.provinces[pid];
  const oldOwnerId = p.ownerId;
  const surv = typeof survivors === 'number' ? { troops: survivors, tanks: 0, air: 0 } : armyOf(survivors);
  if (oldOwnerId === newOwnerId) { addArmy(p, surv); return; }

  const oldC = game.countries[oldOwnerId];
  const newC = game.countries[newOwnerId];

  const idx = oldC.provinces.indexOf(pid);
  if (idx !== -1) oldC.provinces.splice(idx, 1);
  newC.provinces.push(pid);
  p.draft = 1;   // у захваченной провинции призыв снова полный

  const wasCap = p.isCapital;
  p.ownerId = newOwnerId;
  p.troops = Math.max(10, Math.floor(surv.troops));
  p.tanks = Math.floor(surv.tanks);
  p.air = Math.floor(surv.air);
  p.fort = Math.max(0, p.fort - 1);
  p.isCapital = false;

  // Обида: прежний владелец помнит, кто отнял землю
  oldC.grudge = oldC.grudge || {};
  oldC.grudge[newOwnerId] = (oldC.grudge[newOwnerId] || 0) + (p.isCapital ? 2 : 1);

  const rel = getRelation(oldOwnerId, newOwnerId);
  if (oldOwnerId < newOwnerId) rel.warScoreB += wasCap ? 3 : 1;
  else rel.warScoreA += wasCap ? 3 : 1;

  if (wasCap && oldC.provinces.length > 0) {
    let nextCap = game.provinces[oldC.provinces[0]];
    for (const oid of oldC.provinces) {
      if (game.provinces[oid].economy > nextCap.economy) nextCap = game.provinces[oid];
    }
    oldC.capitalProvId = nextCap.id;
    nextCap.isCapital = true;
  }

  // Проверка капитуляции (0 провинций ИЛИ столица взята + >=70% земель потеряно)
  const origCount = game.provinces.filter((pr) => pr && pr.origOwnerId === oldOwnerId).length || 1;
  const lostRatio = 1 - (oldC.provinces.length / Math.max(origCount, oldC.provinces.length + 1));

  if (oldC.provinces.length === 0) {
    oldC.alive = false;
    oldC.capitalProvId = null;
    addNews(`👑 ${oldC.flag} ${oldC.name} полностью покорена державой ${newC.flag} ${newC.name}!`, 'cap', p.cx, p.cy);
    if (newOwnerId === game.playerId) {
      sfx.capture();
      pushToast(`👑 ${oldC.flag} ${oldC.name} полностью капитулировала!`, 'good');
    }
  } else if (wasCap && lostRatio >= 0.7 && oldOwnerId !== game.playerId) {
    const rest = [...oldC.provinces];
    for (const rpid of rest) {
      const rp = game.provinces[rpid];
      rp.ownerId = newOwnerId;
      rp.isCapital = false;
      rp.troops = Math.max(35, Math.floor(rp.troops * 0.35));
      rp.tanks = Math.floor((rp.tanks || 0) * 0.35);
      rp.air = Math.floor((rp.air || 0) * 0.35);
      newC.provinces.push(rpid);
    }
    oldC.provinces = [];
    oldC.alive = false;
    oldC.capitalProvId = null;
    addNews(`👑 ${oldC.flag} ${oldC.name} капитулировала перед ${newC.flag} ${newC.name}!`, 'cap', p.cx, p.cy);
    if (newOwnerId === game.playerId) {
      sfx.capture();
      pushToast(`👑 КАПИТУЛЯЦИЯ! Все территории ${oldC.name} перешли к вам!`, 'good');
    }
  } else {
    if (newOwnerId === game.playerId) sfx.capture();
    addNews(`🚩 ${newC.flag} ${newC.name} захватила ${p.name}`, 'capture', p.cx, p.cy);
  }

  rebuildBorders();
  recomputeCountryLabel(oldOwnerId);
  recomputeCountryLabel(newOwnerId);

  if (game.phase === 'playing') {
    if (!game.countries[game.playerId].alive) {
      game.phase = 'ended';
      game.speed = 0;
      deleteSave();
      showEndModal(false);
    } else if (!game.victoryShown && getWorldPct(game.playerId) >= 60) {
      game.victoryShown = true;
      game.speed = 0;
      showEndModal(true);
    }
  }

  updateHud();
  refreshDrawer();
}

function sendTroops(fromId, toId, ratio) {
  const pFrom = game.provinces[fromId], pTo = game.provinces[toId];
  if (!pFrom || !pTo || !canReach(fromId, toId)) return false;
  const raw = Math.floor(pFrom.troops * ratio);
  const infAmt = Math.max(0, Math.min(raw, Math.floor(pFrom.troops) - (ratio >= 1 ? 5 : 10)));
  const send = { troops: infAmt, tanks: Math.floor((pFrom.tanks || 0) * ratio), air: Math.floor((pFrom.air || 0) * ratio) };
  const sendPower = rawPower(send);
  if (sendPower < 10) return false;

  pFrom.troops -= send.troops;
  pFrom.tanks = (pFrom.tanks || 0) - send.tanks;
  pFrom.air = (pFrom.air || 0) - send.air;
  const isSea = pFrom.seaNeighbors.has(toId) && !pFrom.neighbors.has(toId);
  // длительность в игровых днях; техника и авиация идут быстрее пехоты
  const duration = marchDays(pFrom, pTo, send, isSea);

  game.marches.push({
    ownerId: pFrom.ownerId,
    fromId,
    toId,
    troops: send.troops,
    tanks: send.tanks,
    air: send.air,
    isAttack: pTo.ownerId !== pFrom.ownerId,
    isSea,
    progress: 0,
    duration
  });
  if (pFrom.ownerId === game.playerId) sfx.march();
  else if (pTo.ownerId === game.playerId && pTo.ownerId !== pFrom.ownerId) {
    pushToast(`🚩 ${game.countries[pFrom.ownerId].flag} Враг идёт на ${pTo.name}: будет через ${Math.ceil(duration)} дн.`, 'war');
  }
  return true;
}

function resolveMarch(m) {
  const target = game.provinces[m.toId];
  if (!target) return;

  if (target.ownerId === m.ownerId) {
    addArmy(target, m);
    return;
  }
  if (!isAtWar(m.ownerId, target.ownerId)) {
    const home = game.provinces[m.fromId];
    if (home && home.ownerId === m.ownerId) addArmy(home, m);
    return;
  }

  // Исход решается не сразу: начинается затяжной бой (battle.js)
  startFight(m);
}

// Союзники стороны `side`, воевавшие против `foe` по обязательству, выходят из войны, когда мир заключён
function endJoinedWars(side, foe) {
  for (const x of alliesOf(side)) {
    if (!isAtWar(x, foe)) continue;
    const r = getRelation(x, foe);
    const xWS = x < foe ? r.warScoreA : r.warScoreB;
    const fWS = x < foe ? r.warScoreB : r.warScoreA;
    if (r.aggressor === null && xWS + fWS <= 1) {
      setRelStatus(x, foe, 'pact');
      r.pactUntil = game.totalMonths + 12;
      r.lastWar = game.totalMonths;
    }
  }
}
