'use strict';
/* ГЕГЕМОН — Мировая политика «Мира 2010»: заявки на вступление в организации, ООН (Совбез, Генассамблея,
   резолюции, вето, санкции, приём новых членов) и международные кризисы с выбором сторон.
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Всё живёт в game.applications, game.un, game.crises и сохраняется (save.js). Решения игрока — через очередь
   queueDecision(): окно с вариантами всплывает, когда нет другого окна, и ставит игру на паузу. */

function today() { return game.totalDays || 0; }
function cnm(cid) { const c = game.countries[cid]; return `${c.flag} ${c.name}`; }
function isPlayer(cid) { return cid === game.playerId; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------------------------------------------------------------- временные модификаторы страны
// c.mods = [{ k: 'growth' | 'income', v, until, t }] — например, «жёсткая экономия», «санкции»
function addMod(c, k, v, days, t) {
  c.mods = (c.mods || []).filter((m) => !(m.k === k && m.t === t));
  c.mods.push({ k, v, until: today() + days, t });
  invalidateIncome(c.id);
}
function modSum(c, k) {
  if (!c.mods || !c.mods.length) return 0;
  let s = 0;
  for (const m of c.mods) if (m.k === k && m.until > today()) s += m.v;
  return s;
}
function modList(c, k) { return (c.mods || []).filter((m) => m.k === k && m.until > today()); }

// Смена политического режима (протесты, переворот, реформы)
function setRegime(c, r, why) {
  if (c.regime === r) return;
  const was = REGIME_DEFS[c.regime]?.name || '';
  c.regime = r;
  c.aiAggression = REGIME_DEFS[r].aggr + Math.random() * 0.15;
  invalidateIncome(c.id);
  const cap = game.provinces[c.capitalProvId || c.provinces[0]];
  addNews(`🔄 ${cnm(c.id)}: ${was.toLowerCase()} → ${REGIME_DEFS[r].name.toLowerCase()}${why ? ` (${why})` : ''}`, 'war', cap?.cx ?? null, cap?.cy ?? null);
}

// ---------------------------------------------------------------- ОЧЕРЕДЬ РЕШЕНИЙ ИГРОКА
const pendingDecisions = [];
function queueDecision(d) {
  if (pendingDecisions.some((x) => x.key && x.key === d.key)) return;
  pendingDecisions.push(d);
  checkDecisions();
}
function checkDecisions() {
  if (game.phase !== 'playing' || !pendingDecisions.length) return;
  if (modalBackdrop.classList.contains('visible')) return;
  const d = pendingDecisions.shift();
  if (d.valid && !d.valid()) { checkDecisions(); return; }
  const prevSpeed = game.speed;
  game.speed = 0; updateSpeedBtn();
  const resume = () => { if (game.phase === 'playing' && prevSpeed) { game.speed = prevSpeed; updateSpeedBtn(); } setTimeout(checkDecisions, 0); };
  modalBox.innerHTML = `
    <div class="modal-title">${d.title}</div>
    <div class="modal-body modal-scroll">${d.html}</div>
    <div class="modal-actions decision-actions">${d.options.map((o, i) => `<button class="btn ${o.cls || ''}" data-i="${i}">${o.label}</button>`).join('')}</div>`;
  modalBackdrop.classList.add('visible');
  modalBox.querySelectorAll('.decision-actions [data-i]').forEach((b) => {
    b.onclick = () => {
      const o = d.options[Number(b.dataset.i)];
      modalBackdrop.classList.remove('visible');
      try { if (o.act) o.act(); } finally { updateHud(); refreshDrawer(); resume(); }
    };
  });
}

// =====================================================================================================
// 1. ВСТУПЛЕНИЕ В ОРГАНИЗАЦИИ
// =====================================================================================================
const REG = {
  europe: ['008', '040', '056', '070', '100', '112', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '352',
    '372', '380', '428', '440', '498', '499', '528', '578', '616', '620', '642', '688', '703', '705', '724', '752', '756',
    '804', '807', '826', 'X170', '792', '643', '268', '051', '031'],
  postSoviet: ['643', '112', '804', '498', '051', '031', '268', '398', '417', '762', '860', '795'],
  northAm: ['840', '124', '484', '320', '084', '340', '222', '558', '188', '591', '192', '214', '332', '388', '044', '780'],
  southAm: ['032', '076', '600', '858', '862', '068', '152', '170', '218', '604', '328', '740'],
  seAsia: ['096', '116', '360', '418', '458', '104', '608', '764', '704', '626'],
  asia: ['156', '643', '398', '417', '762', '860', '795', '356', '586', '364', '004', '496', '031', '051', '268', '144', '524',
    '050', '064', '104', '764', '410', '392', '408', '158', '116', '418', '704', '458', '360', '608'],
  africa: ['012', '024', '204', '072', '854', '108', '120', '140', '148', '178', '180', '384', '262', '818', '226', '232', '231',
    '266', '270', '288', '324', '624', '404', '426', '430', '434', '450', '454', '466', '478', '504', '508', '516', '562', '566',
    '646', '686', '694', '706', '710', '729', '748', '834', '768', '788', '800', '894', '716', 'X163'],
  arab: ['012', '262', '818', '368', '400', '414', '422', '434', '478', '504', '512', '275', '634', '682', '706', '729', '760',
    '788', '784', '887'],
  gulfPlus: ['682', '784', '414', '634', '512', '887', '400', '504']
};
const inReg = (c, r) => REG[r].includes(c.iso);
const req = (text, test) => ({ text, test });
const notAtWar = req('не воюет', (c) => enemiesOf(c.id).length === 0);
const demOnly = req('демократический режим', (c) => c.regime === 'dem');

// rule: consensus — достаточно одного «против»; majority — нужны 2/3 голосов «за» от проголосовавших
// stages: 2 — сначала решение об открытии переговоров, потом переговоры (talks дней) и итоговое голосование
const BLOC_JOIN = {
  nato: { rule: 'consensus', stages: 2, talks: 360, need: [req('европейская страна', (c) => inReg(c, 'europe')), demOnly, notAtWar,
    req('не состоит в ОДКБ', (c) => !(c.blocs || []).includes('csto')), req('военные расходы от 1% ВВП', (c) => (c.milexp || 0) >= c.gdp * 0.01)] },
  csto: { rule: 'consensus', stages: 1, need: [req('страна бывшего СССР', (c) => inReg(c, 'postSoviet')), notAtWar,
    req('не состоит в НАТО', (c) => !(c.blocs || []).includes('nato'))] },
  eu: { rule: 'consensus', stages: 2, talks: 900, need: [req('европейская страна', (c) => inReg(c, 'europe')), demOnly, notAtWar,
    req('ВВП на душу от $8000', (c) => gdpPerCapita(c) >= 8000), req('не в Таможенном союзе', (c) => !(c.blocs || []).includes('cu'))] },
  euro: { rule: 'consensus', stages: 1, need: [req('член Евросоюза', (c) => (c.blocs || []).includes('eu')), req('ВВП на душу от $12 000', (c) => gdpPerCapita(c) >= 12000), notAtWar] },
  cu: { rule: 'consensus', stages: 1, need: [req('член СНГ', (c) => (c.blocs || []).includes('cis')), req('не в Евросоюзе', (c) => !(c.blocs || []).includes('eu'))] },
  cis: { rule: 'majority', stages: 1, need: [req('страна бывшего СССР', (c) => inReg(c, 'postSoviet') && !['233', '428', '440'].includes(c.iso))] },
  sco: { rule: 'consensus', stages: 1, need: [req('азиатская страна', (c) => inReg(c, 'asia')), notAtWar] },
  bric: { rule: 'consensus', stages: 1, need: [req('ВВП от $300 млрд', (c) => c.gdp >= 300), req('развивающаяся экономика (до $15 000 на душу)', (c) => gdpPerCapita(c) < 15000)] },
  asean: { rule: 'consensus', stages: 1, need: [req('Юго-Восточная Азия', (c) => inReg(c, 'seAsia')), notAtWar] },
  arab: { rule: 'majority', stages: 1, need: [req('арабская страна', (c) => inReg(c, 'arab'))] },
  gcc: { rule: 'consensus', stages: 1, need: [req('арабская монархия или страна Залива', (c) => inReg(c, 'gulfPlus')), req('монархия или авторитарный режим', (c) => ['abs', 'auth'].includes(c.regime))] },
  au: { rule: 'majority', stages: 1, need: [req('африканская страна', (c) => inReg(c, 'africa')), req('не военный режим', (c) => c.regime !== 'junta')] },
  opec: { rule: 'majority', stages: 1, need: [req('нефть и газ — от 15% экономики', (c) => (c.secShare?.energy || 0) >= 0.15)] },
  nafta: { rule: 'consensus', stages: 1, need: [req('Северная или Центральная Америка', (c) => inReg(c, 'northAm')), notAtWar] },
  mercosur: { rule: 'consensus', stages: 1, need: [req('Южная Америка', (c) => inReg(c, 'southAm')), notAtWar] },
  g8: { rule: 'consensus', stages: 1, need: [req('ВВП от $1 трлн', (c) => c.gdp >= 1000), req('демократия или гибридный режим', (c) => ['dem', 'hyb'].includes(c.regime))] }
};
const STAGE_REVIEW_DAYS = 90;

function joinCheck(cid, bid) {
  const c = game.countries[cid], j = BLOC_JOIN[bid];
  if (!j) return { ok: false, list: [], why: 'в эту организацию не вступают по заявке' };
  const list = j.need.map((r) => ({ text: r.text, ok: !!r.test(c) }));
  return { ok: list.every((x) => x.ok), list };
}
function applicationOf(cid, bid) { return (game.applications || []).find((a) => a.cid === cid && a.bloc === bid); }
function applyBlockLeft(cid, bid) { const b = game.countries[cid].applyBlock; return b && b[bid] ? Math.max(0, b[bid] - today()) : 0; }

function submitApplication(cid, bid, silent) {
  if (applicationOf(cid, bid) || (game.countries[cid].blocs || []).includes(bid)) return false;
  if (!joinCheck(cid, bid).ok || applyBlockLeft(cid, bid)) return false;
  const j = BLOC_JOIN[bid];
  game.applications = game.applications || [];
  game.applications.push({ cid, bloc: bid, stage: j.stages === 2 ? 'review' : 'final', start: today(), next: today() + STAGE_REVIEW_DAYS, votes: {} });
  if (!silent) addNews(`📝 ${BLOC_DEFS[bid].name}: заявку на вступление подала ${cnm(cid)}`, 'ally');
  applicationReactions(cid, bid, 0.5);
  return true;
}

// Соперники недовольны: заявка соседа России в НАТО, страны СНГ в ЕС и т. п.
function applicationReactions(cid, bid, k) {
  const c = game.countries[cid];
  const ru = game.countryByIso.get('643');
  if (ru && ru.alive && ru.id !== cid && (bid === 'nato' || (bid === 'eu' && inReg(c, 'postSoviet')))) {
    changeOpinion(ru.id, cid, -(bid === 'nato' ? 30 : 12) * k);
    if (k >= 1 && !isPlayer(ru.id) && Math.random() < 0.7) makeStatement(ru.id, cid, bid === 'nato' ? 'threat' : 'concern', true);
  }
  if (bid === 'csto') for (const m of blocMembers('nato')) changeOpinion(m.id, cid, -10 * k);
}

function withdrawApplication(cid, bid) {
  game.applications = (game.applications || []).filter((a) => !(a.cid === cid && a.bloc === bid));
}

// Голос члена организации по заявке: 'yes' | 'no' | 'abst'
function memberVoteOnApplicant(mid, cid, bid) {
  const m = game.countries[mid], c = game.countries[cid];
  let s = 0.6 + getOpinion(mid, cid) / 25;
  if (enemiesOf(cid).length) s -= 1.5;
  if ((m.regime === 'dem') !== (c.regime === 'dem')) s -= 0.4;
  if (isMilBloc(bid) && geoNeighbors(cid, game.countryByIso.get('643')?.id) && m.iso !== '840') s -= 0.6;   // «не дразнить Россию»
  for (const e of enemiesOf(cid)) if (isAllied(mid, e)) s -= 3;
  s += pairNoise(mid, cid, 11) * 0.5;
  return s > 0.2 ? 'yes' : s < -0.6 ? 'no' : 'abst';
}

function applicationTally(a) {
  const v = Object.values(a.votes);
  return { yes: v.filter((x) => x === 'yes').length, no: v.filter((x) => x === 'no').length, abst: v.filter((x) => x === 'abst').length };
}

// Голосование по заявке (в конце этапа). Голос игрока — через окно, если игрок в организации.
function runApplicationVote(a) {
  const members = blocMembers(a.bloc).filter((m) => m.id !== a.cid);
  a.votes = {};
  for (const m of members) if (!isPlayer(m.id)) a.votes[m.id] = memberVoteOnApplicant(m.id, a.cid, a.bloc);
  const me = members.find((m) => isPlayer(m.id));
  if (me && !a.playerAsked) {
    a.playerAsked = true;
    a.next = today() + 7;   // ждём ответа игрока неделю
    const d = BLOC_DEFS[a.bloc];
    const stageTxt = a.stage === 'review' ? 'открыть переговоры о вступлении' : 'принять в члены';
    queueDecision({
      key: `app:${a.cid}:${a.bloc}:${a.stage}`,
      title: `🗳 ${d.name}: голосование`,
      valid: () => (game.applications || []).includes(a),
      html: `${cnm(a.cid)} просит ${stageTxt} (${BLOC_DEFS[a.bloc].name}). ${BLOC_JOIN[a.bloc].rule === 'consensus' ? 'Решение принимается единогласно: ваш голос «против» заблокирует вступление.' : 'Нужны 2/3 голосов «за».'}<br><small>Отношение ${game.countries[a.cid].name} к вам: ${getOpinion(a.cid, game.playerId)}. Голос «за» улучшит его, «против» — испортит.</small>`,
      options: [
        { label: '👍 За', cls: 'btn-emerald', act: () => { a.votes[game.playerId] = 'yes'; changeOpinion(a.cid, game.playerId, 10); } },
        { label: 'Воздержаться', act: () => { a.votes[game.playerId] = 'abst'; } },
        { label: '👎 Против', cls: 'btn-crimson', act: () => { a.votes[game.playerId] = 'no'; changeOpinion(a.cid, game.playerId, -25); } }
      ]
    });
    return;   // подведём итог через неделю
  }
  if (me && a.votes[game.playerId] === undefined) a.votes[game.playerId] = 'abst';
  finishApplicationVote(a);
}

function finishApplicationVote(a) {
  const j = BLOC_JOIN[a.bloc], t = applicationTally(a);
  const passed = j.rule === 'consensus' ? t.no === 0 : t.yes >= Math.ceil((t.yes + t.no) * 2 / 3);
  const c = game.countries[a.cid];
  const blockers = Object.entries(a.votes).filter(([, v]) => v === 'no').map(([id]) => game.countries[id].name);
  a.playerAsked = false;
  if (!passed) {
    withdrawApplication(a.cid, a.bloc);
    c.applyBlock = c.applyBlock || {};
    c.applyBlock[a.bloc] = today() + 365;
    addNews(`⛔ ${BLOC_DEFS[a.bloc].name}: отказ в приёме — ${cnm(a.cid)}${blockers.length ? ` (против: ${blockers.slice(0, 4).join(', ')})` : ''}`, 'war');
    for (const [id, v] of Object.entries(a.votes)) if (v === 'no') changeOpinion(a.cid, Number(id), -20);
    if (isPlayer(a.cid)) showInfoModal('⛔ Заявка отклонена', `${BLOC_DEFS[a.bloc].name}: «за» ${t.yes}, «против» ${t.no}, воздержались ${t.abst}.${blockers.length ? `<br><small>Против: ${blockers.join(', ')}.</small>` : ''}<br><small>Повторная заявка — через год.</small>`);
    return;
  }
  if (a.stage === 'review') {
    a.stage = 'talks';
    a.next = today() + (j.talks || 360);
    a.votes = {};
    addNews(`🤝 ${BLOC_DEFS[a.bloc].name}: начаты переговоры о вступлении — ${cnm(a.cid)}`, 'ally');
    if (isPlayer(a.cid)) pushToast(`🤝 ${BLOC_DEFS[a.bloc].name}: переговоры о вступлении начались (≈${Math.round((j.talks || 360) / 30)} мес.)`, 'good');
    return;
  }
  withdrawApplication(a.cid, a.bloc);
  joinBloc(a.cid, a.bloc);
  if (isPlayer(a.cid)) showInfoModal(`🎉 Вы вступили: ${BLOC_DEFS[a.bloc].name}`, `«За» ${t.yes}, «против» ${t.no}, воздержались ${t.abst}.`);
}

function joinBloc(cid, bid) {
  const c = game.countries[cid];
  if ((c.blocs || []).includes(bid)) return;
  c.blocs = BLOC_ORDER.filter((b) => b === bid || (c.blocs || []).includes(b));
  if (isMilBloc(bid)) for (const m of blocMembers(bid)) if (m.id !== cid) setRelStatus(cid, m.id, 'ally');
  for (const m of blocMembers(bid)) if (m.id !== cid) { changeOpinion(m.id, cid, 10); changeOpinion(cid, m.id, 10); }
  applicationReactions(cid, bid, 1);
  invalidateIncome(cid);
  const cap = game.provinces[c.capitalProvId || c.provinces[0]];
  addNews(`🎉 ${BLOC_DEFS[bid].name}: новый член — ${cnm(cid)}`, 'ally', cap?.cx ?? null, cap?.cy ?? null);
}

// Ежедневно: сроки этапов
function processApplicationsDay() {
  for (const a of [...(game.applications || [])]) {
    const c = game.countries[a.cid];
    if (!c.alive) { withdrawApplication(a.cid, a.bloc); continue; }
    if (today() < a.next) continue;
    if (!joinCheck(a.cid, a.bloc).ok) {   // перестала соответствовать — переговоры замораживаются
      a.next = today() + 90;
      if (isPlayer(a.cid) && !a.frozenWarned) { a.frozenWarned = true; pushToast(`🧊 ${BLOC_DEFS[a.bloc].name}: переговоры заморожены — не выполнены условия`, 'war'); }
      continue;
    }
    a.frozenWarned = false;
    if (a.playerAsked) finishApplicationVote(a);
    else runApplicationVote(a);
  }
}

// ИИ иногда подаёт заявки сам
function aiApplicationsMonth() {
  for (const c of game.countries) {
    if (!c.alive || isPlayer(c.id) || Math.random() > 0.05) continue;
    for (const bid of Object.keys(BLOC_JOIN)) {
      if ((c.blocs || []).includes(bid) || applicationOf(c.id, bid) || applyBlockLeft(c.id, bid)) continue;
      if (!joinCheck(c.id, bid).ok) continue;
      const mem = blocMembers(bid);
      if (!mem.length) continue;
      const avg = mem.reduce((s, m) => s + getOpinion(c.id, m.id), 0) / mem.length;
      if (avg < 15 || Math.random() > 0.08) continue;
      submitApplication(c.id, bid);
      break;
    }
  }
}

// =====================================================================================================
// 2. ООН
// =====================================================================================================
// Непостоянные члены Совбеза в 2010 году
const SC_2010 = ['040', '392', '484', '792', '800', '070', '076', '266', '422', '566'];

function unMembers() { return game.countries.filter((c) => c.alive && c.un); }
function scMembers() {
  const p5 = game.countries.filter((c) => c.alive && c.p5);
  const np = (game.un?.sc || []).map((s) => game.countries[s.id]).filter((c) => c && c.alive);
  return [...p5, ...np];
}
function onSC(cid) { return game.countries[cid].p5 || (game.un?.sc || []).some((s) => s.id === cid); }

const RES_KINDS = {
  condemn:   { body: 'ga', icon: '📢', name: 'Осудить', title: (t) => `${t}: осуждение действий` },
  ceasefire: { body: 'sc', icon: '🕊️', name: 'Требовать прекращения огня', title: (t) => `${t}: требование прекратить огонь` },
  sanctions: { body: 'sc', icon: '⛔', name: 'Ввести санкции', title: (t) => `${t}: санкции` },
  lift:      { body: 'sc', icon: '🔓', name: 'Снять санкции', title: (t) => `${t}: снятие санкций` },
  intervention: { body: 'sc', icon: '🛩', name: 'Разрешить вмешательство', title: (t) => `${t}: разрешение на применение силы` },
  admit:     { body: 'sc+ga', icon: '🇺🇳', name: 'Принять в ООН', title: (t) => `${t}: приём в члены ООН` }
};
const RES_VOTE_DAYS = 20;
// Непризнанные и частично признанные государства → от кого отделились
const BREAKAWAY = { X163: '706', X170: '688', '158': '156' };

function initUN(sc) {
  game.un = { sc: [], res: [], archive: [], nextId: 1, sanctions: [] };
  const ids = (sc ? SC_2010 : []).map((iso) => game.countryByIso.get(iso)).filter((c) => c && c.alive);
  ids.forEach((c, i) => game.un.sc.push({ id: c.id, until: i < 5 ? 365 : 730 }));
}

// Перевыборы непостоянных членов Совбеза (каждые полгода проверяем истёкшие сроки)
function unElections() {
  if (!game.un) return;
  const leaving = game.un.sc.filter((s) => s.until <= today());
  if (!leaving.length) return;
  game.un.sc = game.un.sc.filter((s) => s.until > today());
  const pool = unMembers().filter((c) => !c.p5 && !onSC(c.id) && !leaving.some((s) => s.id === c.id));
  const chosen = [];
  for (let i = 0; i < leaving.length && pool.length; i++) {
    const w = pool.map((c) => Math.pow(c.gdp || 1, 0.35) * (0.5 + Math.random()));
    let best = 0; for (let k = 1; k < pool.length; k++) if (w[k] > w[best]) best = k;
    const c = pool.splice(best, 1)[0];
    game.un.sc.push({ id: c.id, until: today() + 730 });
    chosen.push(c);
  }
  if (chosen.length) addNews(`🇺🇳 Новые непостоянные члены Совбеза ООН: ${chosen.map((c) => c.flag + ' ' + c.name).join(', ')}`, 'ally');
  if (chosen.some((c) => isPlayer(c.id))) pushToast('🇺🇳 Вас избрали в Совет Безопасности ООН на 2 года', 'good');
}

function activeSanctions(cid) { return (game.un?.sanctions || []).filter((s) => s.target === cid && s.until > today()); }
function underSanctions(cid) { return activeSanctions(cid).length > 0; }
// Соблюдает ли страна санкции против target (друзья санкции нарушают)
function sanctionsBlockTrade(a, b) {
  for (const [x, t] of [[a, b], [b, a]]) {
    if (!underSanctions(t)) continue;
    const X = game.countries[x];
    if (X.un && getOpinion(x, t) < 40 && !isAllied(x, t)) return true;
  }
  return false;
}

function proposeResolution(kind, target, sponsor, extra = {}) {
  if (!game.un) return null;
  if (game.un.res.some((r) => r.kind === kind && r.target === target)) return null;
  const K = RES_KINDS[kind];
  const r = { id: game.un.nextId++, kind, target, sponsor, body: K.body, start: today(), end: today() + RES_VOTE_DAYS,
    votes: {}, ga: {}, status: 'voting', title: K.title(game.countries[target].name), ...extra };
  game.un.res.push(r);
  addNews(`🇺🇳 ${sponsor !== null && sponsor !== undefined ? cnm(sponsor) + ' внесла' : 'Внесён'} проект резолюции: ${r.title}`, 'ally');
  askPlayerVote(r);
  return r;
}

// Позиция страны по резолюции
function unVoteScore(cid, r) {
  const c = game.countries[cid], t = r.target;
  if (cid === t) return r.kind === 'admit' || r.kind === 'lift' ? 3 : -3;
  const op = getOpinion(cid, t);
  let s;
  if (r.kind === 'admit') {
    s = 0.6 + op / 30;
    const parent = BREAKAWAY[game.countries[t].iso];
    if (parent) {
      const P = game.countryByIso.get(parent);
      if (P && P.alive) { s -= 0.6; if (P.id === cid) s -= 5; else s -= Math.max(0, getOpinion(cid, P.id)) / 25; }
    }
    for (const o of game.countries) {
      if (!o.alive || o.id === cid || o.id === t || getOpinion(o.id, t) > -30) continue;
      if (o.id === cid) continue;
      s -= Math.max(0, getOpinion(cid, o.id)) / 45;   // друзья противников кандидата
    }
  } else if (r.kind === 'lift') {
    s = op / 30 - 0.2;
  } else {
    s = -op / 30;
    if (r.aggression) s += 0.8;          // нападение на члена ООН — повод осудить даже без вражды
    if (r.kind === 'condemn') s += 0.2;
    if (['sanctions', 'intervention'].includes(r.kind) && ['auth', 'party', 'theo', 'hyb', 'junta'].includes(c.regime)) s -= 0.5;   // «невмешательство»
    if (r.kind === 'sanctions' && hasTrade(cid, t)) s -= 0.5;
    if (isAllied(cid, t)) s -= 3;
    if (r.victim !== undefined && isAllied(cid, r.victim)) s += 1.5;
  }
  if (r.sponsor !== null && r.sponsor !== undefined && r.sponsor !== cid) s += getOpinion(cid, r.sponsor) / 80;
  return s + pairNoise(cid, t, 13 + r.id) * 0.4;
}
function unAiVote(cid, r) { const s = unVoteScore(cid, r); return s > 0.35 ? 'yes' : s < -0.35 ? 'no' : 'abst'; }

function askPlayerVote(r) {
  const p = game.playerId;
  if (p === null || p === undefined || !game.countries[p].un) return;
  const inSC = onSC(p), sc = r.body.includes('sc');
  if (!inSC && !r.body.includes('ga')) return;
  // окно — только когда голос весом: вы в Совбезе, или речь о вас, ваших союзниках, соседях, врагах
  const t = r.target, op = Math.abs(getOpinion(p, t));
  const close = t === p || isAllied(p, t) || geoNeighbors(p, t) || op >= 40 || isAtWar(p, t) || (r.victim !== undefined && (r.victim === p || isAllied(p, r.victim)));
  if (!(sc && inSC) && !close) return;
  const veto = sc && game.countries[p].p5;
  queueDecision({
    key: `res:${r.id}`,
    title: `🇺🇳 ${r.body.includes('sc') ? 'Совет Безопасности' : 'Генеральная Ассамблея'}: голосование`,
    valid: () => r.status === 'voting',
    html: `<strong>${RES_KINDS[r.kind].icon} ${r.title}</strong>${r.why ? `<br><small>${r.why}</small>` : ''}<br>
      <small>Внесла: ${r.sponsor !== null && r.sponsor !== undefined ? cnm(r.sponsor) : '—'}. ${veto ? 'Вы постоянный член Совбеза: ваше «против» — вето.' : ''}
      ${game.countries[t].name} относится к вам: ${getOpinion(t, p)}. «За» испортит отношения с ней, «против» — улучшит.</small>`,
    options: [
      { label: '👍 За', cls: 'btn-emerald', act: () => castPlayerVote(r, 'yes') },
      { label: 'Воздержаться', act: () => castPlayerVote(r, 'abst') },
      { label: veto ? '✋ Против (вето)' : '👎 Против', cls: 'btn-crimson', act: () => castPlayerVote(r, 'no') }
    ]
  });
}

function castPlayerVote(r, v) {
  const p = game.playerId;
  if (r.status !== 'voting') return;
  r.playerVote = v;
  const t = r.target;
  const good = r.kind === 'admit' || r.kind === 'lift';
  if (v === 'yes') { changeOpinion(t, p, good ? 12 : -12); if (r.sponsor !== null && r.sponsor !== undefined) changeOpinion(r.sponsor, p, 5); }
  if (v === 'no') { changeOpinion(t, p, good ? -15 : 12); if (r.sponsor !== null && r.sponsor !== undefined) changeOpinion(r.sponsor, p, -6); }
}

function tallyOf(votes) {
  const v = Object.values(votes);
  return { yes: v.filter((x) => x === 'yes').length, no: v.filter((x) => x === 'no').length, abst: v.filter((x) => x === 'abst').length };
}

function closeResolution(r) {
  const p = game.playerId;
  const vote = (cid) => (isPlayer(cid) ? (r.playerVote || 'abst') : unAiVote(cid, r));
  let passed = true, vetoBy = [];
  if (r.body.includes('sc')) {
    r.votes = {};
    for (const c of scMembers()) r.votes[c.id] = vote(c.id);
    const t = tallyOf(r.votes);
    vetoBy = scMembers().filter((c) => c.p5 && r.votes[c.id] === 'no').map((c) => c.name);
    passed = t.yes >= 9 && vetoBy.length === 0;
  }
  if (passed && r.body.includes('ga')) {
    r.ga = {};
    for (const c of unMembers()) r.ga[c.id] = vote(c.id);
    const g = tallyOf(r.ga);
    passed = r.kind === 'admit' ? g.yes >= Math.ceil((g.yes + g.no) * 2 / 3) : g.yes > g.no;
  }
  r.status = passed ? 'passed' : vetoBy.length ? 'vetoed' : 'failed';
  r.vetoBy = vetoBy;
  game.un.res = game.un.res.filter((x) => x !== r);
  game.un.archive.unshift(r);
  if (game.un.archive.length > 30) game.un.archive.length = 30;
  // Отношения: голосовавшие «за» против цели — запомнены ею
  const all = { ...(r.ga || {}), ...(r.votes || {}) };
  const good = r.kind === 'admit' || r.kind === 'lift';
  for (const [id, v] of Object.entries(all)) {
    const cid = Number(id);
    if (cid === r.target || isPlayer(cid)) continue;
    if (v === 'yes') changeOpinion(r.target, cid, good ? 6 : -6);
    if (v === 'no') changeOpinion(r.target, cid, good ? -8 : 6);
  }
  const t = tallyOf(r.votes || {}), g = tallyOf(r.ga || {});
  const score = r.body.includes('sc') ? `Совбез ${t.yes}–${t.no}–${t.abst}` : `ГА ${g.yes}–${g.no}–${g.abst}`;
  if (r.status === 'vetoed') addNews(`✋ Резолюция «${r.title}» заблокирована вето: ${vetoBy.join(', ')}`, 'war');
  else addNews(`🇺🇳 Резолюция «${r.title}» ${passed ? 'принята' : 'не принята'} (${score}${r.kind === 'admit' && g.yes + g.no + g.abst > 0 ? `, ГА ${g.yes}–${g.no}` : ''})`, passed ? 'ally' : '');
  if (passed) applyResolution(r);
  if (isPlayer(r.target) || isPlayer(r.sponsor)) pushToast(`🇺🇳 «${r.title}»: ${r.status === 'passed' ? 'принята' : r.status === 'vetoed' ? 'вето' : 'не принята'}`, passed === isPlayer(r.sponsor) ? 'good' : 'war');
}

function applyResolution(r) {
  const T = game.countries[r.target];
  if (r.kind === 'condemn') { T.honor = Math.max(0, T.honor - 8); }
  if (r.kind === 'ceasefire') { T.ceasefireUntil = today() + 240; T.honor = Math.max(0, T.honor - 4); }
  if (r.kind === 'sanctions') {
    game.un.sanctions.push({ target: r.target, until: today() + 720, resId: r.id });
    addMod(T, 'income', -0.12, 720, 'санкции ООН');
    addMod(T, 'growth', -0.02, 720, 'санкции ООН');
    for (const pid of tradePartners(r.target)) if (sanctionsBlockTrade(r.target, pid)) cancelTrade(r.target, pid);
  }
  if (r.kind === 'lift') {
    game.un.sanctions = game.un.sanctions.filter((s) => s.target !== r.target);
    T.mods = (T.mods || []).filter((m) => m.t !== 'санкции ООН');
    invalidateIncome(T.id);
  }
  if (r.kind === 'admit') { T.un = true; invalidateIncome(T.id); }
  if (r.kind === 'intervention') {
    T.interventionUntil = today() + 360;
    // коалиция: сторонники резолюции решают, вступать ли
    const sup = Object.entries(r.votes || {}).filter(([, v]) => v === 'yes').map(([id]) => Number(id));
    let joined = 0;
    for (const cid of sup) {
      if (isPlayer(cid)) {
        queueDecision({
          key: `int:${r.id}`, title: '🛩 Коалиция по мандату ООН',
          html: `Совбез разрешил применить силу против ${cnm(r.target)}. Присоединиться к коалиции? Война по мандату ООН не портит репутацию.`,
          options: [{ label: '⚔️ Присоединиться', cls: 'btn-crimson', act: () => { if (!isAtWar(cid, r.target)) declareWar(cid, r.target, false, true); } }, { label: 'Не участвовать' }]
        });
      } else if (joined < 4 && getOpinion(cid, r.target) < -20 && game.countries[cid].gdp > 200 && Math.random() < 0.5) {
        if (!isAtWar(cid, r.target)) { declareWar(cid, r.target, true, true); joined++; }
      }
    }
  }
}

function processUNDay() {
  if (!game.un) return;
  for (const r of [...game.un.res]) if (today() >= r.end) closeResolution(r);
  game.un.sanctions = game.un.sanctions.filter((s) => s.until > today());
}

function processUNMonth() {
  if (!game.un) return;
  if (game.month === 0 || game.month === 6) unElections();
  // Санкции дольше года: друзья цели предлагают их снять
  for (const s of game.un.sanctions) {
    if (today() - (s.until - 720) < 365 || Math.random() > 0.15) continue;
    const friend = scMembers().find((c) => !isPlayer(c.id) && getOpinion(c.id, s.target) > 30);
    if (friend) proposeResolution('lift', s.target, friend.id);
  }
  // Не члены ООН время от времени просятся
  for (const c of game.countries) {
    if (!c.alive || c.un || isPlayer(c.id) || Math.random() > 0.01) continue;
    proposeResolution('admit', c.id, c.id);
  }
}

// Война: члены ООН реагируют резолюциями
function unOnWar(atk, def, joined) {
  if (!game.un || joined) return;
  const A = game.countries[atk], D = game.countries[def];
  if (!D.un) return;
  const sponsors = game.countries.filter((c) => c.alive && c.un && c.id !== atk && c.id !== def && !isPlayer(c.id) && ((c.blocs || []).includes('g8') || c.p5) && getOpinion(c.id, atk) < 20);
  if (!sponsors.length) return;
  const sp = pick(sponsors).id;
  const why = `Нападение: ${A.name} → ${D.name}.`;
  if (Math.random() < 0.6) proposeResolution('condemn', atk, sp, { aggression: true, victim: def, why });
  if (Math.random() < 0.45) proposeResolution('ceasefire', atk, sp, { aggression: true, victim: def, why });
}

// =====================================================================================================
// 3. КРИЗИСЫ
// =====================================================================================================
// Каждый тип: подбор цели (find), роли участников, варианты для каждой роли, выбор ИИ, развязка (resolve).
// Роли: 'gov' — правительство страны в кризисе, 'party' — вторая сторона (для двусторонних), 'world' — остальные.
const CRISIS_MAX = 3;

const CRISES = {
  disaster: {
    icon: '🌋', name: 'Стихийное бедствие', days: 60,
    find() {
      const cands = game.countries.filter((c) => c.alive && c.provinces.length && !crisisOf(c.id));
      if (!cands.length) return null;
      const w = cands.map((c) => Math.sqrt(c.pop || 1));
      let r = Math.random() * w.reduce((s, x) => s + x, 0);
      for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return { target: cands[i].id, data: { kind: pick(['Землетрясение', 'Наводнение', 'Ураган', 'Цунами', 'Засуха']) } }; }
      return null;
    },
    begin(cr) {
      const T = game.countries[cr.target];
      const loss = 0.02 + Math.random() * 0.04;
      cr.data.loss = loss;
      for (const pid of T.provinces) game.provinces[pid].gdp *= 1 - loss;
      invalidateIncome(T.id);
      cr.data.need = Math.round(taxIncome(T) * 2);
      cr.data.aid = 0;
    },
    title: (cr) => `${game.countries[cr.target].name}: ${cr.data.kind.toLowerCase()}`,
    text: (cr) => `Погибли люди, разрушены города. ВВП страны упал на ${Math.round(cr.data.loss * 100)}%. Чтобы быстро восстановиться, нужна помощь ≈${fmtNum(cr.data.need)}💰.`,
    roles: (cr, cid) => (cid === cr.target ? 'gov' : 'world'),
    relevant: (cr, cid) => getOpinion(cid, cr.target) >= 20 || geoNeighbors(cid, cr.target) || isAllied(cid, cr.target),
    options: {
      gov: [{ id: 'accept', label: '🙏 Принять помощь', desc: 'Помощь всех стран примем с благодарностью' }],
      world: [
        { id: 'aid_big', label: '🚑 Крупная помощь', desc: 'Казна: 1,5 месячного дохода. Отношение +25', cost: 1.5 },
        { id: 'aid', label: '📦 Гуманитарная помощь', desc: 'Казна: полмесячного дохода. Отношение +12', cost: 0.5 },
        { id: 'none', label: 'Ничего не делать', desc: '' }
      ]
    },
    ai(cr, cid, role) {
      if (role === 'gov') return 'accept';
      const op = getOpinion(cid, cr.target), c = game.countries[cid];
      if (op >= 45 && c.money > taxIncome(c) * 3) return 'aid_big';
      if (op >= 15 && c.money > taxIncome(c)) return 'aid';
      return 'none';
    },
    onChoose(cr, cid, opt) {
      if (opt.cost) {
        const c = game.countries[cid], m = Math.round(taxIncome(c) * opt.cost);
        if (c.money < m) return false;
        c.money -= m;
        cr.data.aid += m;
        changeOpinion(cr.target, cid, opt.id === 'aid_big' ? 25 : 12);
      }
      return true;
    },
    resolve(cr) {
      const T = game.countries[cr.target];
      const share = Math.min(1, cr.data.aid / Math.max(1, cr.data.need));
      for (const pid of T.provinces) game.provinces[pid].gdp *= 1 + cr.data.loss * 0.8 * share;
      T.money += Math.round(cr.data.aid * 0.5);
      invalidateIncome(T.id);
      const donors = Object.entries(cr.stances).filter(([, v]) => v.startsWith('aid')).map(([id]) => game.countries[id].name);
      return donors.length ? `Помогли: ${donors.slice(0, 6).join(', ')}${donors.length > 6 ? ` и ещё ${donors.length - 6}` : ''}. Восстановлено ${Math.round(share * 80)}% потерь.` : 'Страна восстанавливается сама, без помощи.';
    }
  },

  debt: {
    icon: '💸', name: 'Долговой кризис', days: 120,
    find() {
      const seed = game.countryByIso.get('300');   // Греция 2010
      if (seed && seed.alive && !game.crisisSeeds?.debtGreece && game.year === 2010 && (seed.blocs || []).includes('euro')) {
        game.crisisSeeds = { ...(game.crisisSeeds || {}), debtGreece: true };
        return { target: seed.id, data: {} };
      }
      const cands = game.countries.filter((c) => c.alive && !crisisOf(c.id) && growthRate(c).g < 0.012 && gdpPerCapita(c) > 4000);
      return cands.length && Math.random() < 0.3 ? { target: pick(cands).id, data: {} } : null;
    },
    begin(cr) { const T = game.countries[cr.target]; cr.data.need = Math.round(taxIncome(T) * 5); cr.data.aid = 0; cr.data.reforms = 0; },
    title: (cr) => `${game.countries[cr.target].name}: долговой кризис`,
    text: (cr) => `Страна не может обслуживать долг. Чтобы избежать дефолта, кредиторы должны собрать ≈${fmtNum(cr.data.need)}💰. Без помощи — дефолт и обвал экономики${(game.countries[cr.target].blocs || []).includes('euro') ? ', а возможно, и выход из еврозоны' : ''}.`,
    roles(cr, cid) {
      if (cid === cr.target) return 'gov';
      const T = game.countries[cr.target], c = game.countries[cid];
      const lender = (T.blocs || []).filter((b) => ['eu', 'euro', 'cu', 'gcc', 'nafta'].includes(b)).some((b) => (c.blocs || []).includes(b)) || c.p5 || (c.blocs || []).includes('g8');
      return lender ? 'world' : null;
    },
    relevant: (cr, cid) => true,
    options: {
      gov: [
        { id: 'austerity', label: '✂️ Принять жёсткую экономию', desc: 'Рост ВВП −1,5% на 2 года, зато кредиторы охотнее помогут' },
        { id: 'refuse', label: '🙅 Отказаться от условий', desc: 'Кредиторы недовольны, помощь меньше' }
      ],
      world: [
        { id: 'loan', label: '🏦 Дать кредит', desc: 'Казна: месячный доход. Отношение +15', cost: 1 },
        { id: 'reforms', label: '📋 Кредит только за реформы', desc: 'Казна: полмесяца дохода. Отношение −5', cost: 0.5 },
        { id: 'none', label: 'Отказать', desc: 'Отношение −10' }
      ]
    },
    ai(cr, cid, role) {
      if (role === 'gov') return Math.random() < 0.75 ? 'austerity' : 'refuse';
      const c = game.countries[cid], op = getOpinion(cid, cr.target);
      if (c.money < taxIncome(c) * 1.5) return 'none';
      if (op >= 40) return 'loan';
      if (op >= 10) return 'reforms';
      return 'none';
    },
    onChoose(cr, cid, opt) {
      if (opt.id === 'austerity') { cr.data.austerity = true; addMod(game.countries[cid], 'growth', -0.015, 720, 'жёсткая экономия'); return true; }
      if (opt.cost) {
        const c = game.countries[cid], m = Math.round(taxIncome(c) * opt.cost);
        if (c.money < m) return false;
        c.money -= m; cr.data.aid += m * (cr.data.austerity || opt.id === 'loan' ? 1 : 0.7);
        changeOpinion(cr.target, cid, opt.id === 'loan' ? 15 : -5);
        // кредит вернут с процентами через 3 года
        game.loans = game.loans || [];
        game.loans.push({ from: cid, to: cr.target, sum: Math.round(m * 1.1), due: today() + 1080 });
      } else if (opt.id === 'none') changeOpinion(cr.target, cid, -10);
      return true;
    },
    resolve(cr) {
      const T = game.countries[cr.target];
      if (cr.data.aid >= cr.data.need) {
        T.money += Math.round(cr.data.aid * 0.3);
        return `Кредиторы собрали ${fmtNum(cr.data.aid)}💰 — дефолта не будет${cr.data.austerity ? ', но экономию придётся терпеть' : ''}.`;
      }
      for (const pid of T.provinces) game.provinces[pid].gdp *= 0.9;
      invalidateIncome(T.id);
      addMod(T, 'growth', -0.02, 540, 'дефолт');
      let extra = '';
      if ((T.blocs || []).includes('euro') && Math.random() < 0.6) { T.blocs = T.blocs.filter((b) => b !== 'euro'); extra = ' Страна вышла из еврозоны.'; }
      for (const [id, v] of Object.entries(cr.stances)) if (v === 'none') changeOpinion(cr.target, Number(id), -10);
      return `Помощи не хватило (${fmtNum(cr.data.aid)} из ${fmtNum(cr.data.need)}💰): дефолт, ВВП −10%.${extra}`;
    }
  },

  protests: {
    icon: '✊', name: 'Массовые протесты', days: 90,
    find() {
      const hard = ['auth', 'abs', 'party', 'junta', 'theo'];
      const recent = new Set((game.crisisLog || []).filter((x) => x.type === 'protests' && today() - x.day < 365).map((x) => x.target));
      const cands = [];
      for (const c of game.countries) {
        if (!c.alive || !hard.includes(c.regime) || crisisOf(c.id) || recent.has(c.id) || isPlayer(c.id) && Math.random() < 0.5) continue;
        let w = gdpPerCapita(c) < 3000 ? 1.5 : gdpPerCapita(c) < 15000 ? 1 : 0.3;
        if (growthRate(c).g < 0.02) w *= 1.5;
        for (const n of geoInfo(c.id).nbrs) if (recent.has(n)) w *= 3;   // волна протестов перекидывается на соседей
        if (inReg(c, 'arab') && game.year >= 2011) w *= 1.8;
        if (c.iso === '788' && game.year === 2010 && game.month >= 10) w *= 40;   // Тунис, конец 2010
        cands.push({ c, w });
      }
      const total = cands.reduce((s, x) => s + x.w, 0);
      if (!total || Math.random() > Math.min(0.6, total / 60)) return null;
      let r = Math.random() * total;
      for (const x of cands) { r -= x.w; if (r <= 0) return { target: x.c.id, data: {} }; }
      return null;
    },
    begin(cr) { cr.data.support = 0; cr.data.gov = 0; },
    title: (cr) => `${game.countries[cr.target].name}: массовые протесты`,
    text: (cr) => `Сотни тысяч людей на улицах требуют смены власти. ${REGIME_DEFS[game.countries[cr.target].regime].name} под угрозой.`,
    roles: (cr, cid) => (cid === cr.target ? 'gov' : 'world'),
    relevant: (cr, cid) => game.countries[cid].p5 || geoNeighbors(cid, cr.target) || Math.abs(getOpinion(cid, cr.target)) >= 40 || isAllied(cid, cr.target),
    options: {
      gov: [
        { id: 'reform', label: '🗳 Реформы и выборы', desc: 'Режим станет гибридным, протесты утихнут' },
        { id: 'suppress', label: '🚔 Подавить силой', desc: 'Может сработать — или перерасти в гражданскую войну. Демократии осудят' },
        { id: 'resign', label: '🏳 Уйти в отставку', desc: 'Власть перейдёт к оппозиции (демократия)' }
      ],
      world: [
        { id: 'protest', label: '✊ Поддержать протестующих', desc: 'Правительство: −25. Если оно падёт, новая власть запомнит' },
        { id: 'gov', label: '🤝 Поддержать правительство', desc: 'Правительство: +20. Если оно падёт, новая власть запомнит' },
        { id: 'none', label: 'Не вмешиваться', desc: '' }
      ]
    },
    ai(cr, cid, role) {
      const c = game.countries[cid], T = game.countries[cr.target];
      if (role === 'gov') return T.regime === 'abs' ? (Math.random() < 0.5 ? 'reform' : 'suppress') : ['party', 'theo', 'junta'].includes(T.regime) ? 'suppress' : (Math.random() < 0.65 ? 'suppress' : 'reform');
      const op = getOpinion(cid, cr.target);
      if (op >= 35 || isAllied(cid, cr.target)) return 'gov';
      if (c.regime === 'dem' && op < 10) return 'protest';
      return 'none';
    },
    onChoose(cr, cid, opt) {
      if (opt.id === 'protest') { cr.data.support++; changeOpinion(cr.target, cid, -25); }
      if (opt.id === 'gov') { cr.data.gov++; changeOpinion(cr.target, cid, 20); }
      if (opt.id === 'suppress') for (const c of game.countries) if (c.alive && c.regime === 'dem' && c.id !== cid) changeOpinion(c.id, cid, -8);
      return true;
    },
    resolve(cr) {
      const T = game.countries[cr.target], g = cr.stances[cr.target];
      let fell = false, newReg = 'hyb', civil = false;
      if (g === 'reform') { newReg = 'hyb'; fell = true; }
      else if (g === 'resign') { newReg = 'dem'; fell = true; }
      else {
        const hold = { party: 0.3, theo: 0.2, junta: 0.15, abs: 0.1 }[T.regime] || 0;
        const p = 0.4 + cr.data.support * 0.07 - cr.data.gov * 0.07 - hold;
        if (Math.random() < p) { if (Math.random() < 0.45) civil = true; else { fell = true; newReg = Math.random() < 0.3 ? 'dem' : 'hyb'; } }
      }
      if (civil) {
        addMod(T, 'growth', -0.05, 540, 'гражданская война');
        for (const pid of T.provinces) game.provinces[pid].gdp *= 0.88;
        invalidateIncome(T.id);
        const sp = scMembers().find((c) => c.p5 && !isPlayer(c.id) && cr.stances[c.id] === 'protest');
        if (sp) proposeResolution('intervention', cr.target, sp.id, { why: `Режим ${T.name} подавляет протесты силой, страна на грани гражданской войны.` });
        return 'Подавление не удалось: страна скатилась в гражданскую войну. ВВП −12%.';
      }
      if (fell) {
        setRegime(T, newReg, 'после протестов');
        for (const [id, v] of Object.entries(cr.stances)) {
          if (Number(id) === cr.target) continue;
          if (v === 'protest') changeOpinion(cr.target, Number(id), 45);   // новая власть помнит, кто её поддержал
          if (v === 'gov') changeOpinion(cr.target, Number(id), -45);
        }
        return `Власть сменилась: теперь это ${REGIME_DEFS[newReg].name.toLowerCase()}.`;
      }
      return 'Власть удержалась, протесты подавлены.';
    }
  },

  nuclear: {
    icon: '☢️', name: 'Ядерная программа', days: 900,
    find() {
      const seed = game.countryByIso.get('364');   // Иран
      if (seed && seed.alive && !seed.nukes && !game.crisisSeeds?.iran) {
        game.crisisSeeds = { ...(game.crisisSeeds || {}), iran: true };
        return { target: seed.id, data: { progress: 0.35 } };
      }
      const cands = game.countries.filter((c) => c.alive && !c.nukes && !crisisOf(c.id) && c.gdp > 60 && ['theo', 'party', 'auth', 'junta'].includes(c.regime) &&
        game.countries.some((o) => o.alive && o.nukes && getOpinion(c.id, o.id) <= -50));
      return cands.length && Math.random() < 0.05 ? { target: pick(cands).id, data: { progress: 0 } } : null;
    },
    begin(cr) { cr.data.talks = 0; cr.data.frozen = false; },
    title: (cr) => `${game.countries[cr.target].name}: ядерная программа`,
    text: (cr) => `Разведки сообщают, что ${game.countries[cr.target].name} может создать ядерное оружие примерно за ${Math.max(1, Math.round((1 - cr.data.progress) * 30))} мес. Мир требует остановить программу.`,
    roles: (cr, cid) => (cid === cr.target ? 'gov' : 'world'),
    relevant: (cr, cid) => game.countries[cid].p5 || geoNeighbors(cid, cr.target) || getOpinion(cid, cr.target) <= -40,
    options: {
      gov: [
        { id: 'continue', label: '⚛️ Продолжать программу', desc: 'Когда бомба будет готова, на вас никто не нападёт. Санкции почти неизбежны' },
        { id: 'deal', label: '🤝 Заморозить в обмен на снятие санкций', desc: 'Кризис закончится, отношения с Западом улучшатся' }
      ],
      world: [
        { id: 'sanctions', label: '⛔ Требовать санкций ООН', desc: 'Внести резолюцию в Совбез. Отношение цели −20' },
        { id: 'talks', label: '🕊 Переговоры', desc: 'Повышает шанс сделки. Отношение цели +5' },
        { id: 'support', label: '🛡 Право на мирный атом', desc: 'Отношение цели +15, Запада −' }
      ]
    },
    ai(cr, cid, role) {
      if (role === 'gov') return (cr.data.talks >= 3 && underSanctions(cid)) || Math.random() < 0.1 ? 'deal' : 'continue';
      const op = getOpinion(cid, cr.target);
      if (op <= -40 && game.countries[cid].p5) return 'sanctions';
      if (op >= 25) return 'support';
      return 'talks';
    },
    onChoose(cr, cid, opt) {
      if (opt.id === 'sanctions') { changeOpinion(cr.target, cid, -20); if (onSC(cid) || game.countries[cid].p5) proposeResolution('sanctions', cr.target, cid, { why: 'Ядерная программа в нарушение договора о нераспространении.' }); }
      if (opt.id === 'talks') { cr.data.talks += game.countries[cid].p5 || (game.countries[cid].blocs || []).includes('g8') ? 2 : 0.5; changeOpinion(cr.target, cid, 5); }
      if (opt.id === 'support') { changeOpinion(cr.target, cid, 15); for (const c of blocMembers('nato')) changeOpinion(c.id, cid, -5); }
      if (opt.id === 'deal') { cr.data.frozen = true; cr.end = today(); }
      return true;
    },
    // ИИ может пересмотреть решение по ходу (сделка под санкциями)
    tick(cr) {
      if (cr.data.frozen) return;
      cr.data.progress += 1 / 900 * (underSanctions(cr.target) ? 0.6 : 1);
      if (!isPlayer(cr.target) && cr.stances[cr.target] === 'continue' && today() % 60 === 0 && cr.data.talks >= 3 && (underSanctions(cr.target) || cr.data.talks >= 8) && Math.random() < (underSanctions(cr.target) ? 0.25 : 0.12)) {
        cr.stances[cr.target] = 'deal'; cr.data.frozen = true; cr.end = today();
      }
      if (cr.data.progress >= 1) cr.end = today();
    },
    resolve(cr) {
      const T = game.countries[cr.target];
      if (cr.data.frozen) {
        game.un.sanctions = (game.un.sanctions || []).filter((s) => s.target !== cr.target);
        T.mods = (T.mods || []).filter((m) => m.t !== 'санкции ООН');
        for (const c of game.countries) if (c.alive && cr.stances[c.id] === 'talks') changeOpinion(c.id, cr.target, 15);
        return 'Заключена сделка: программа заморожена, санкции сняты.';
      }
      if (cr.data.progress >= 1) {
        T.nukes = true;
        for (const c of game.countries) if (c.alive && c.id !== T.id && cr.stances[c.id] !== 'support') changeOpinion(c.id, T.id, -15);
        return `${T.name} провела ядерное испытание и стала ядерной державой.`;
      }
      return 'Программа продолжается.';
    }
  },

  border: {
    icon: '💥', name: 'Пограничный инцидент', days: 45,
    find() {
      const pairs = [];
      for (const c of game.countries) {
        if (!c.alive || crisisOf(c.id)) continue;
        for (const n of geoInfo(c.id).nbrs) {
          if (n < c.id) continue;
          const o = game.countries[n];
          if (!o.alive || crisisOf(n) || isAtWar(c.id, n) || sharedMilBloc(c.id, n)) continue;
          const op = Math.min(getOpinion(c.id, n), getOpinion(n, c.id));
          if (op <= -40) pairs.push([c.id, n, -op]);
        }
      }
      if (!pairs.length || Math.random() > 0.35) return null;
      const p = pick(pairs);
      return { target: p[0], other: p[1], data: {} };
    },
    begin(cr) { cr.data.mediators = []; },
    title: (cr) => `Граница ${game.countries[cr.target].name} — ${game.countries[cr.other].name}: инцидент`,
    text: () => 'Перестрелка пограничников, есть погибшие. Стороны обвиняют друг друга. Конфликт может перерасти в войну.',
    roles: (cr, cid) => (cid === cr.target || cid === cr.other ? 'gov' : 'world'),
    relevant: (cr, cid) => game.countries[cid].p5 || isAllied(cid, cr.target) || isAllied(cid, cr.other) || geoNeighbors(cid, cr.target) || geoNeighbors(cid, cr.other),
    options: {
      gov: [
        { id: 'calm', label: '🕊 Деэскалация', desc: 'Выразить сожаление, отвести войска. Отношения с соседом +10' },
        { id: 'hard', label: '💪 Жёсткий ответ', desc: 'Если обе стороны ответят жёстко — возможна война' }
      ],
      world: [
        { id: 'mediate', label: '🤝 Предложить посредничество', desc: 'Если обе стороны вам доверяют — шанс погасить кризис, репутация +5' },
        { id: 'sideA', label: '👉 Поддержать первую сторону', desc: '' },
        { id: 'sideB', label: '👉 Поддержать вторую сторону', desc: '' },
        { id: 'none', label: 'Наблюдать', desc: '' }
      ]
    },
    ai(cr, cid, role) {
      const c = game.countries[cid];
      if (role === 'gov') { const foe = cid === cr.target ? cr.other : cr.target; return getOpinion(cid, foe) < -60 || c.aiAggression > 0.35 ? 'hard' : 'calm'; }
      const oa = getOpinion(cid, cr.target), ob = getOpinion(cid, cr.other);
      if (oa >= 0 && ob >= 0 && (c.p5 || (c.blocs || []).includes('g8')) && Math.random() < 0.5) return 'mediate';
      if (oa - ob > 40) return 'sideA';
      if (ob - oa > 40) return 'sideB';
      return 'none';
    },
    onChoose(cr, cid, opt) {
      if (opt.id === 'calm') { const foe = cid === cr.target ? cr.other : cr.target; changeOpinion(foe, cid, 10); }
      if (opt.id === 'mediate') cr.data.mediators.push(cid);
      if (opt.id === 'sideA') { changeOpinion(cr.target, cid, 12); changeOpinion(cr.other, cid, -15); }
      if (opt.id === 'sideB') { changeOpinion(cr.other, cid, 12); changeOpinion(cr.target, cid, -15); }
      return true;
    },
    resolve(cr) {
      const a = cr.stances[cr.target], b = cr.stances[cr.other];
      const med = cr.data.mediators.find((m) => getOpinion(cr.target, m) >= 0 && getOpinion(cr.other, m) >= 0);
      if (med !== undefined && Math.random() < 0.65) {
        game.countries[med].honor = Math.min(100, game.countries[med].honor + 5);
        changeOpinion(cr.target, med, 10); changeOpinion(cr.other, med, 10);
        changeOpinion(cr.target, cr.other, 15); changeOpinion(cr.other, cr.target, 15);
        return `Кризис урегулирован при посредничестве ${game.countries[med].name}.`;
      }
      if (a === 'hard' && b === 'hard') {
        changeOpinion(cr.target, cr.other, -20); changeOpinion(cr.other, cr.target, -20);
        if (Math.random() < 0.35) {
          const atk = Math.random() < 0.5 ? cr.target : cr.other, def = atk === cr.target ? cr.other : cr.target;
          if (!isPlayer(atk)) { declareWar(atk, def); return `Инцидент перерос в войну: ${game.countries[atk].name} напала на ${game.countries[def].name}.`; }
        }
        return 'Стороны обменялись угрозами, напряжённость осталась.';
      }
      return 'Стороны отвели войска, инцидент исчерпан.';
    }
  },

  coup: {
    icon: '🎖️', name: 'Военный переворот', days: 60,
    find() {
      const cands = game.countries.filter((c) => c.alive && !isPlayer(c.id) && !crisisOf(c.id) && c.gdp < 150 &&
        (['hyb', 'auth'].includes(c.regime) && gdpPerCapita(c) < 4000 || c.regime === 'dem' && gdpPerCapita(c) < 2000));
      return cands.length && Math.random() < 0.5 ? { target: pick(cands).id, data: {} } : null;
    },
    begin(cr) { const T = game.countries[cr.target]; cr.data.was = T.regime; setRegime(T, 'junta', 'переворот'); cr.data.recog = 0; cr.data.cond = 0; },
    title: (cr) => `${game.countries[cr.target].name}: военный переворот`,
    text: (cr) => `Армия свергла правительство (${REGIME_DEFS[cr.data.was].name.toLowerCase()}). Хунта обещает выборы «когда наведёт порядок».`,
    roles: (cr, cid) => (cid === cr.target ? 'gov' : 'world'),
    relevant: (cr, cid) => geoNeighbors(cid, cr.target) || Math.abs(getOpinion(cid, cr.target)) >= 40 || game.countries[cid].p5,
    options: {
      gov: [{ id: 'hold', label: '🎖 Удерживать власть', desc: '' }],
      world: [
        { id: 'recognize', label: '🤝 Признать новую власть', desc: 'Хунта: +20. Демократии недовольны' },
        { id: 'condemn', label: '📢 Осудить и потребовать выборов', desc: 'Хунта: −20' },
        { id: 'embargo', label: '⛔ Разорвать торговлю', desc: 'Хунта: −30, торговля прекращается' }
      ]
    },
    ai(cr, cid, role) {
      if (role === 'gov') return 'hold';
      const c = game.countries[cid];
      if (c.regime === 'dem') return Math.random() < 0.3 ? 'embargo' : 'condemn';
      return getOpinion(cid, cr.target) > 0 ? 'recognize' : 'condemn';
    },
    onChoose(cr, cid, opt) {
      if (opt.id === 'recognize') { cr.data.recog++; changeOpinion(cr.target, cid, 20); }
      if (opt.id === 'condemn') { cr.data.cond++; changeOpinion(cr.target, cid, -20); }
      if (opt.id === 'embargo') { cr.data.cond += 2; changeOpinion(cr.target, cid, -30); cancelTrade(cid, cr.target, cid, 'переворот'); }
      return true;
    },
    resolve(cr) {
      const T = game.countries[cr.target];
      if (cr.data.cond > cr.data.recog * 2 && Math.random() < 0.6) { setRegime(T, 'hyb', 'хунта уступила давлению и провела выборы'); return 'Под давлением мира хунта провела выборы.'; }
      return 'Хунта удержала власть.';
    }
  }
};

function crisisOf(cid) { return (game.crises || []).find((cr) => cr.target === cid || cr.other === cid); }

function startCrisis(type, found) {
  const T = CRISES[type];
  const cr = { id: (game.crisisNext = (game.crisisNext || 1) + 1), type, target: found.target, other: found.other, start: today(), end: today() + T.days, stances: {}, data: found.data || {} };
  game.crises = game.crises || [];
  game.crises.push(cr);
  if (T.begin) T.begin(cr);
  const tc = game.countries[cr.target];
  const cap = game.provinces[tc.capitalProvId || tc.provinces[0]];
  addNews(`${T.icon} ${T.title(cr)}`, 'war', cap?.cx ?? null, cap?.cy ?? null);
  // ИИ занимает позиции сразу
  for (const c of game.countries) {
    if (!c.alive || isPlayer(c.id)) continue;
    const role = T.roles(cr, c.id);
    if (!role) continue;
    if (role === 'world' && !(T.relevant(cr, c.id) || Math.random() < 0.1)) continue;
    chooseCrisisOption(cr, c.id, T.ai(cr, c.id, role), true);
  }
  // Игроку — окно, если кризис его касается
  const p = game.playerId;
  if (p !== null && p !== undefined) {
    const role = T.roles(cr, p);
    if (role && (role === 'gov' || T.relevant(cr, p))) askCrisis(cr);
  }
}

function crisisOptions(cr, cid) {
  const T = CRISES[cr.type], role = T.roles(cr, cid);
  if (!role) return [];
  let opts = T.options[role] || [];
  if (cr.type === 'border' && role === 'world') {
    const a = game.countries[cr.target].name, b = game.countries[cr.other].name;
    opts = opts.map((o) => (o.id === 'sideA' ? { ...o, label: `👉 На стороне: ${a}` } : o.id === 'sideB' ? { ...o, label: `👉 На стороне: ${b}` } : o));
  }
  return opts;
}

function chooseCrisisOption(cr, cid, optId, silent) {
  if (cr.stances[cid] !== undefined) return false;
  const opt = crisisOptions(cr, cid).find((o) => o.id === optId);
  if (!opt) return false;
  const T = CRISES[cr.type];
  if (T.onChoose && T.onChoose(cr, cid, opt) === false) return false;
  cr.stances[cid] = optId;
  if (!silent || (optId !== 'none' && optId !== 'accept' && optId !== 'hold' && (game.countries[cid].p5 || Math.random() < 0.25))) {
    if (optId !== 'none') addNews(`${T.icon} ${cnm(cid)}: «${opt.label.replace(/^\S+\s/, '')}» — ${T.title(cr)}`, '');
  }
  return true;
}

function askCrisis(cr) {
  const T = CRISES[cr.type], p = game.playerId;
  const opts = crisisOptions(cr, p);
  if (!opts.length || cr.stances[p] !== undefined) return;
  queueDecision({
    key: `cr:${cr.id}`,
    title: `${T.icon} ${T.title(cr)}`,
    valid: () => (game.crises || []).includes(cr) && cr.stances[p] === undefined,
    html: `${T.text(cr)}${crisisStancesHtml(cr)}`,
    options: opts.map((o) => ({
      label: `${o.label}${o.desc ? `<small>${o.desc}</small>` : ''}`,
      cls: 'decision-opt',
      act: () => { if (!chooseCrisisOption(cr, p, o.id)) pushToast('Не хватает денег в казне', 'war'); }
    }))
  });
}

function crisisStancesHtml(cr) {
  const T = CRISES[cr.type];
  const rows = Object.entries(cr.stances).filter(([, v]) => v !== 'none').slice(0, 10).map(([id, v]) => {
    const o = crisisOptions(cr, Number(id)).find((x) => x.id === v);
    return o ? `<span class="stance-chip">${game.countries[id].flag} ${game.countries[id].name}: ${o.label.replace(/^\S+\s/, '')}</span>` : '';
  }).join('');
  return rows ? `<div class="stance-chips">${rows}</div>` : '';
}

function resolveCrisis(cr) {
  const T = CRISES[cr.type];
  const res = T.resolve(cr);
  game.crises = game.crises.filter((x) => x !== cr);
  game.crisisLog = game.crisisLog || [];
  game.crisisLog.unshift({ type: cr.type, target: cr.target, other: cr.other, day: today(), title: T.title(cr), result: res, icon: T.icon });
  if (game.crisisLog.length > 30) game.crisisLog.length = 30;
  addNews(`${T.icon} ${T.title(cr)}: ${res}`, 'ally');
  const p = game.playerId;
  if (cr.stances[p] !== undefined || cr.target === p || cr.other === p) pushToast(`${T.icon} ${res}`, 'good');
  invalidateIncome(cr.target);
}

function processCrisesDay() {
  for (const cr of [...(game.crises || [])]) {
    const T = CRISES[cr.type];
    if (!game.countries[cr.target].alive) { game.crises = game.crises.filter((x) => x !== cr); continue; }
    if (T.tick) T.tick(cr);
    if (today() >= cr.end) resolveCrisis(cr);
  }
  // Возврат кредитов
  if (game.loans && game.loans.length) {
    for (const l of [...game.loans]) {
      if (l.due > today()) continue;
      game.loans = game.loans.filter((x) => x !== l);
      const to = game.countries[l.to], from = game.countries[l.from];
      if (!to.alive || !from.alive) continue;
      const pay = Math.min(l.sum, Math.max(0, to.money));
      to.money -= pay; from.money += pay;
      if (isPlayer(l.from)) pushToast(`🏦 ${to.flag} ${to.name} вернула кредит: +${fmtNum(pay)}💰`, 'good');
      if (pay < l.sum) changeOpinion(l.from, l.to, -15);
    }
  }
}

function processCrisesMonth() {
  game.crises = game.crises || [];
  const seeds = game.crisisSeeds || {};
  if (game.year === 2010 && game.month >= 1 && !seeds.iran) { const f = CRISES.nuclear.find(); if (f) startCrisis('nuclear', f); }
  if (game.year === 2010 && game.month >= 3 && !(game.crisisSeeds || {}).debtGreece) { const f = CRISES.debt.find(); if (f) startCrisis('debt', f); }
  if (game.crises.length >= CRISIS_MAX) return;
  // В среднем новый кризис раз в 2–3 месяца; стихийные бедствия чаще
  const order = Object.keys(CRISES).sort(() => Math.random() - 0.5);
  const base = { disaster: 0.1, debt: 0.06, protests: 0.18, nuclear: 0.08, border: 0.12, coup: 0.05 };
  for (const type of order) {
    if (game.crises.length >= CRISIS_MAX) break;
    if (Math.random() > base[type]) continue;
    if (type !== 'disaster' && game.crises.some((c) => c.type === type)) continue;
    const found = CRISES[type].find();
    if (found && game.countries[found.target]) { startCrisis(type, found); break; }
  }
}

// =====================================================================================================
// ИНИЦИАЛИЗАЦИЯ, ХОДЫ
// =====================================================================================================
function initWorldOrder() {
  game.applications = [];
  game.crises = [];
  game.crisisLog = [];
  game.crisisSeeds = {};
  game.loans = [];
  initUN(true);
  for (const c of game.countries) { c.mods = []; c.applyBlock = {}; }
  // Заявки, которые были в работе на 1 января 2010 года
  const seed = (iso, bloc, stage, daysLeft) => {
    const c = game.countryByIso.get(iso);
    if (!c || !c.alive) return;
    game.applications.push({ cid: c.id, bloc, stage, start: -365, next: daysLeft, votes: {} });
  };
  seed('191', 'eu', 'talks', 900);    // Хорватия — переговоры (вступила в 2013)
  seed('352', 'eu', 'review', 200);   // Исландия — заявка 2009
  seed('688', 'eu', 'review', 330);   // Сербия — заявка декабря 2009
  seed('499', 'nato', 'review', 400); // Черногория — План действий
  seed('807', 'nato', 'review', 120); // Македония — блокирует Греция
}

function processWorldOrderDay() {
  if (!scenarioActive() || !game.un) return;
  processApplicationsDay();
  processUNDay();
  processCrisesDay();
}

function processWorldOrderMonth() {
  if (!scenarioActive() || !game.un) return;
  aiApplicationsMonth();
  processUNMonth();
  processCrisesMonth();
}

// =====================================================================================================
// ОКНО «МИРОВАЯ ПОЛИТИКА» (кнопка 🌐)
// =====================================================================================================
const WORLD_TABS = [['crises', 'Кризисы'], ['un', 'ООН'], ['join', 'Вступление']];

function showWorldModal(tab = 'crises') {
  if (game.phase !== 'playing' || !scenarioActive() || !game.un) return;
  let body = '';
  if (tab === 'crises') body = worldCrisesHtml();
  else if (tab === 'un') body = worldUNHtml();
  else body = worldJoinHtml();
  modalBox.innerHTML = `
    <div class="modal-title">🌐 Мировая политика</div>
    <div class="state-tabs">${WORLD_TABS.map(([id, n]) => `<button class="state-tab ${id === tab ? 'active' : ''}" data-tab="${id}">${n}</button>`).join('')}</div>
    <div class="modal-body modal-scroll" style="display:flex;flex-direction:column;gap:8px;">${body}</div>
    <div class="modal-actions"><button class="btn btn-sky" id="m-ok">Закрыть</button></div>`;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;
  modalBox.querySelectorAll('.state-tab').forEach((b) => { b.onclick = () => showWorldModal(b.dataset.tab); });
  bindWorldModal(tab);
}

function worldCrisesHtml() {
  const p = game.playerId;
  const act = (game.crises || []).map((cr) => {
    const T = CRISES[cr.type];
    const mine = cr.stances[p];
    const opts = crisisOptions(cr, p);
    const myOpt = mine !== undefined ? opts.find((o) => o.id === mine) : null;
    return `<div class="crisis-card">
      <div class="crisis-head"><span>${T.icon} <strong>${T.title(cr)}</strong></span><small>ещё ${Math.max(0, cr.end - today())} дн.</small></div>
      <small>${T.text(cr)}</small>
      ${crisisStancesHtml(cr)}
      ${myOpt ? `<small class="my-stance">Ваша позиция: ${myOpt.label}</small>`
        : opts.length ? `<div class="crisis-opts">${opts.map((o) => `<button class="btn btn-sm" data-cr="${cr.id}" data-opt="${o.id}" title="${o.desc}">${o.label}</button>`).join('')}</div>`
        : '<small style="color:var(--muted)">Вас этот кризис не касается.</small>'}
    </div>`;
  }).join('') || '<small style="color:var(--muted)">Сейчас в мире спокойно.</small>';
  const log = (game.crisisLog || []).slice(0, 8).map((x) => `<div class="trade-row"><span>${x.icon} ${x.title}</span><small style="white-space:normal">${x.result}</small></div>`).join('');
  return `${act}${log ? `<div class="modal-sub-title">Недавно</div>${log}` : ''}`;
}

function worldUNHtml() {
  const p = game.playerId, me = game.countries[p];
  const sc = scMembers().map((c) => `<span class="bloc-chip ${c.p5 ? 'mil' : 'pol'}" style="--bc:${c.p5 ? '#38bdf8' : '#64748b'}">${c.flag} ${c.name}</span>`).join('');
  const status = me.un ? (me.p5 ? 'Вы постоянный член Совета Безопасности: у вас право вето.' : onSC(p) ? 'Вы непостоянный член Совета Безопасности.' : 'Вы член ООН и голосуете в Генеральной Ассамблее.')
    : 'Вы не член ООН: вы не голосуете и не вносите резолюции, а нападение на вас ООН не обсуждает.';
  const res = (game.un.res || []).map((r) => {
    const K = RES_KINDS[r.kind];
    const can = me.un && (r.body.includes('ga') || onSC(p));
    return `<div class="crisis-card">
      <div class="crisis-head"><span>${K.icon} <strong>${r.title}</strong></span><small>${r.body === 'ga' ? 'Генассамблея' : r.body === 'sc' ? 'Совбез' : 'Совбез + ГА'} • ещё ${Math.max(0, r.end - today())} дн.</small></div>
      ${r.why ? `<small>${r.why}</small>` : ''}
      <small>Прогноз: ${resForecast(r)}</small>
      ${can ? `<div class="crisis-opts">${['yes', 'abst', 'no'].map((v) => `<button class="btn btn-sm ${r.playerVote === v ? 'active' : ''}" data-res="${r.id}" data-v="${v}">${v === 'yes' ? '👍 За' : v === 'no' ? (me.p5 && r.body.includes('sc') ? '✋ Вето' : '👎 Против') : 'Воздержаться'}</button>`).join('')}</div>` : ''}
    </div>`;
  }).join('') || '<small style="color:var(--muted)">Сейчас голосований нет.</small>';
  const arch = (game.un.archive || []).slice(0, 8).map((r) => `<div class="trade-row"><span>${RES_KINDS[r.kind].icon} ${r.title}</span><b style="color:${r.status === 'passed' ? '#34d399' : '#f87171'}">${r.status === 'passed' ? 'принята' : r.status === 'vetoed' ? 'вето' : 'нет'}</b></div>`).join('');
  const sanc = (game.un.sanctions || []).map((s) => `${game.countries[s.target].flag} ${game.countries[s.target].name} (ещё ${Math.round((s.until - today()) / 30)} мес.)`).join(', ');
  const targets = game.countries.filter((c) => c.alive && c.id !== p).sort((a, b) => getOpinion(p, a.id) - getOpinion(p, b.id));
  return `
    <small style="color:var(--muted)">${status} Членов ООН: ${unMembers().length}.</small>
    <div class="modal-sub-title">Совет Безопасности</div><div class="bloc-chips">${sc}</div>
    ${sanc ? `<small style="color:var(--muted)">Под санкциями ООН: ${sanc}.</small>` : ''}
    <div class="modal-sub-title">На голосовании</div>${res}
    ${me.un ? `<div class="modal-sub-title">Внести резолюцию (15 🏛️)</div>
      <div class="propose-row">
        <select id="un-kind">${['condemn', 'ceasefire', 'sanctions', 'lift'].map((k) => `<option value="${k}">${RES_KINDS[k].icon} ${RES_KINDS[k].name}</option>`).join('')}</select>
        <select id="un-target">${targets.map((c) => `<option value="${c.id}">${c.flag} ${c.name} (${getOpinion(p, c.id)})</option>`).join('')}</select>
        <button class="btn btn-sm btn-sky" id="un-propose" ${me.diplo >= 15 ? '' : 'disabled'}>Внести</button>
      </div>
      <small style="color:var(--muted)">Совбез: нужно 9 голосов «за» и ни одного вето. Генассамблея: «за» больше, чем «против».</small>`
    : `<button class="btn btn-sky" id="un-apply" ${(game.un.res || []).some((r) => r.kind === 'admit' && r.target === p) ? 'disabled' : ''}>🇺🇳 Подать заявку на вступление в ООН</button>
       <small style="color:var(--muted)">Нужна рекомендация Совбеза (без вето) и 2/3 Генассамблеи.</small>`}
    ${arch ? `<div class="modal-sub-title">Архив</div>${arch}` : ''}`;
}

function resForecast(r) {
  const vote = (cid) => (isPlayer(cid) ? (r.playerVote || 'abst') : unAiVote(cid, r));
  const parts = [];
  if (r.body.includes('sc')) {
    const v = {}; for (const c of scMembers()) v[c.id] = vote(c.id);
    const t = tallyOf(v);
    const veto = scMembers().filter((c) => c.p5 && v[c.id] === 'no').map((c) => c.name);
    parts.push(`Совбез ${t.yes}–${t.no}–${t.abst}${veto.length ? `, вето: ${veto.join(', ')}` : ''}`);
  }
  if (r.body.includes('ga')) {
    const v = {}; for (const c of unMembers()) v[c.id] = vote(c.id);
    const t = tallyOf(v);
    parts.push(`ГА ${t.yes}–${t.no}–${t.abst}`);
  }
  return parts.join('; ');
}

function worldJoinHtml() {
  const p = game.playerId, me = game.countries[p];
  const myApps = (game.applications || []).filter((a) => a.cid === p).map((a) => {
    const d = BLOC_DEFS[a.bloc];
    const stage = a.stage === 'review' ? 'заявка рассматривается' : a.stage === 'talks' ? 'идут переговоры' : 'ждёт голосования';
    return `<div class="trade-row"><span>${d.name}</span><small>${stage}, ещё ${Math.max(0, a.next - today())} дн.</small><button class="btn btn-sm" data-withdraw="${a.bloc}">Отозвать</button></div>`;
  }).join('');
  const rows = Object.keys(BLOC_JOIN).filter((b) => !(me.blocs || []).includes(b) && !applicationOf(p, b)).map((b) => {
    const d = BLOC_DEFS[b], chk = joinCheck(p, b), blk = applyBlockLeft(p, b);
    const mem = blocMembers(b);
    const support = mem.length ? mem.filter((m) => memberVoteOnApplicant(m.id, p, b) === 'yes').length : 0;
    const against = mem.filter((m) => memberVoteOnApplicant(m.id, p, b) === 'no').map((m) => m.name);
    return `<div class="bloc-row">
      <div class="bloc-row-head"><span class="bloc-chip ${d.type}" style="--bc:${d.color}">${d.name}</span><small>${BLOC_TYPE_NAME[d.type]} • ${countriesWord(mem.length)}</small>
        <button class="btn btn-sm ${chk.ok && !blk ? 'btn-sky' : ''}" data-apply="${b}" ${chk.ok && !blk ? '' : 'disabled'}>📝 ${blk ? `через ${blk} дн.` : 'Заявка'}</button></div>
      <small>${chk.list.map((x) => `${x.ok ? '✅' : '❌'} ${x.text}`).join(' • ')}</small>
      ${chk.ok ? `<small>Сейчас «за» ${support} из ${mem.length}${against.length ? `, против: ${against.slice(0, 4).join(', ')}${against.length > 4 ? '…' : ''}` : ''}. ${BLOC_JOIN[b].rule === 'consensus' ? 'Нужно единогласие.' : 'Нужны 2/3.'}</small>` : ''}
    </div>`;
  }).join('');
  // Заявки других стран в организации, где состоит игрок
  const others = (game.applications || []).filter((a) => a.cid !== p && (me.blocs || []).includes(a.bloc)).map((a) =>
    `<div class="trade-row"><span>${cnm(a.cid)} → ${BLOC_DEFS[a.bloc].name}</span><small>${a.stage === 'talks' ? 'переговоры' : 'рассмотрение'}, голосование через ${Math.max(0, a.next - today())} дн.</small></div>`).join('');
  return `
    ${myApps ? `<div class="modal-sub-title">Ваши заявки</div>${myApps}` : ''}
    ${others ? `<div class="modal-sub-title">Просятся в ваши организации</div>${others}<small style="color:var(--muted)">Когда дойдёт до голосования, вас спросят.</small>` : ''}
    <div class="modal-sub-title">Куда можно вступить</div>
    <small style="color:var(--muted)">Заявку рассматривают ${STAGE_REVIEW_DAYS} дней; в НАТО и ЕС потом идут переговоры (≈1 и ≈2,5 года) и второе голосование. Члены голосуют по своему отношению к вам. Пока идут переговоры, условия надо выполнять.</small>
    ${rows || '<small style="color:var(--muted)">Вы уже во всех доступных организациях.</small>'}`;
}

function bindWorldModal(tab) {
  const p = game.playerId;
  modalBox.querySelectorAll('[data-cr]').forEach((b) => {
    b.onclick = () => {
      const cr = (game.crises || []).find((x) => x.id === Number(b.dataset.cr));
      if (cr && !chooseCrisisOption(cr, p, b.dataset.opt)) pushToast('Не хватает денег в казне', 'war');
      updateHud(); showWorldModal('crises');
    };
  });
  modalBox.querySelectorAll('[data-res]').forEach((b) => {
    b.onclick = () => {
      const r = (game.un.res || []).find((x) => x.id === Number(b.dataset.res));
      if (r) castPlayerVote(r, b.dataset.v);
      showWorldModal('un');
    };
  });
  const bp = document.getElementById('un-propose');
  if (bp) bp.onclick = () => {
    const me = game.countries[p];
    const kind = document.getElementById('un-kind').value, t = Number(document.getElementById('un-target').value);
    if (me.diplo < 15) return;
    if (kind === 'lift' && !underSanctions(t)) { pushToast('С этой страны нечего снимать: санкций ООН нет', 'war'); return; }
    const r = proposeResolution(kind, t, p, { aggression: enemiesOf(t).some((e) => getRelation(t, e).aggressor === t), why: `Проект внесла ${me.name}.` });
    if (!r) { pushToast('Такая резолюция уже на голосовании', 'war'); return; }
    me.diplo -= 15; r.playerVote = kind === 'lift' ? 'yes' : 'yes';
    changeOpinion(t, p, kind === 'lift' ? 15 : -15);
    updateHud(); showWorldModal('un');
  };
  const ba = document.getElementById('un-apply');
  if (ba) ba.onclick = () => { proposeResolution('admit', p, p, { why: 'Заявка на вступление.' }); showWorldModal('un'); };
  modalBox.querySelectorAll('[data-apply]').forEach((b) => {
    b.onclick = () => {
      if (submitApplication(p, b.dataset.apply)) pushToast(`📝 Заявка подана: ${BLOC_DEFS[b.dataset.apply].name}`, 'good');
      showWorldModal('join');
    };
  });
  modalBox.querySelectorAll('[data-withdraw]').forEach((b) => {
    b.onclick = () => { withdrawApplication(p, b.dataset.withdraw); showWorldModal('join'); };
  });
}
