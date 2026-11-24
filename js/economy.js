'use strict';
/* ГЕГЕМОН — Ресурсы: производство, потребление, склады, рынок, найм
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Три ресурса:
     🌾 food  — продовольствие. Съедает пехота (1 на 300 солдат в месяц). Голод: потери и нет прироста.
     🛢 fuel  — топливо. Нужно технике и авиации. Нехватка: техника воюет вполсилы.
     🔩 steel — сталь. Идёт на постройку техники и фортов. */

const RES_KEYS = ['food', 'fuel', 'steel'];
const RES_DEFS = {
  food:  { icon: '🌾', name: 'Продовольствие', buy: 3,   sell: 1   },   // покупка в 1,5 раза дороже прежнего (было 2)
  fuel:  { icon: '🛢', name: 'Топливо',        buy: 4,   sell: 2   },
  steel: { icon: '🔩', name: 'Сталь',          buy: 5,   sell: 2.5 }
};
const MARKET_LOT = 100;
const RES_BASE_YIELD = { food: 3.6, fuel: 1.8, steel: 1.4 }; // на единицу экономики провинции
const FOOD_PER_SOLDIER = 1 / 300;
const STARVE_LOSS = 0.03;

// Профиль страны по ISO: [еда, топливо, сталь] — множитель производства
const RES_PROFILE = {
  '643': [1.3, 2.6, 2.0], '840': [2.0, 1.8, 1.6], '156': [1.8, 0.8, 3.0], '356': [2.0, 0.2, 1.6],
  '076': [2.4, 1.2, 1.8], '124': [1.6, 1.8, 1.0], '036': [1.4, 0.6, 2.6], '804': [2.6, 0.2, 1.8],
  '398': [1.2, 1.6, 1.4], '682': [0.1, 3.4, 0.2], '364': [0.6, 2.8, 0.8], '368': [0.5, 2.6, 0.2],
  '784': [0.1, 2.6, 0.2], '414': [0.1, 2.4, 0.1], '634': [0.1, 2.2, 0.1], '512': [0.2, 1.4, 0.2],
  '434': [0.3, 2.2, 0.2], '012': [0.6, 2.0, 0.4], '566': [1.0, 2.0, 0.3], '024': [0.6, 1.8, 0.2],
  '862': [0.8, 2.4, 0.3], '484': [1.2, 1.2, 0.6], '578': [0.6, 2.0, 0.8], '826': [0.9, 0.8, 0.8],
  '276': [1.2, 0.1, 1.8], '250': [2.0, 0.1, 0.8], '392': [0.6, 0.0, 1.8], '710': [1.0, 0.1, 2.4],
  '792': [1.6, 0.1, 1.2], '032': [2.4, 0.3, 0.5], '152': [0.8, 0.1, 2.2], '604': [1.0, 0.3, 1.8],
  '180': [0.6, 0.2, 2.4], '752': [0.8, 0.1, 2.0], '410': [0.6, 0.0, 1.6], '616': [1.6, 0.1, 1.2],
  '380': [1.2, 0.1, 0.8], '724': [1.4, 0.1, 0.8], '764': [2.2, 0.1, 0.2], '704': [2.0, 0.2, 0.2],
  '360': [1.8, 0.8, 0.8], '586': [1.6, 0.1, 0.4], '818': [1.0, 1.0, 0.2], '504': [1.0, 0.1, 0.8],
  '031': [0.6, 1.8, 0.2], '795': [0.5, 1.6, 0.2], '860': [1.0, 0.4, 0.8]
};
const RES_PROFILE_DEFAULT = [0.8, 0.15, 0.35];

// Детерминированное «разнообразие» провинций: 0.6 … 1.4
function provVariety(pid, salt) {
  const x = Math.sin(pid * 12.9898 + salt * 78.233) * 43758.5453;
  return 0.6 + (x - Math.floor(x)) * 0.8;
}

// Месячный выход ресурсов провинции
function provinceYield(p) {
  const owner = game.countries[p.origOwnerId]; // богатство земли не зависит от того, кто её захватил
  const prof = RES_PROFILE[owner.iso] || RES_PROFILE_DEFAULT;
  const out = {};
  RES_KEYS.forEach((k, i) => {
    out[k] = p.economy * prof[i] * RES_BASE_YIELD[k] * provVariety(p.id, i + 1);
  });
  return out;
}

function resCap(c) {
  return 2000 + c.provinces.length * 150;
}

// Производство, потребление и чистый месячный баланс страны
function countryResFlow(cid) {
  const c = game.countries[cid];
  const prod = { food: 0, fuel: 0, steel: 0 };
  const army = emptyArmy();
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    const y = provinceYield(p);
    for (const k of RES_KEYS) prod[k] += y[k];
    addArmy(army, p);
  }
  for (const m of game.marches) if (m.ownerId === cid) addArmy(army, m);
  const use = {
    food: army.troops * FOOD_PER_SOLDIER,
    fuel: army.tanks * FUEL_UPKEEP.tanks + army.air * FUEL_UPKEEP.air,
    steel: 0
  };
  const net = {};
  for (const k of RES_KEYS) net[k] = prod[k] - use[k];
  return { prod, use, net };
}

function initResources() {
  for (const c of game.countries) {
    c.starving = false;
    c.noFuel = false;
    const flow = countryResFlow(c.id);
    c.res = {
      food: Math.round(flow.prod.food * 4),
      fuel: Math.round(flow.prod.fuel * 3),
      steel: Math.round(flow.prod.steel * 3)
    };
  }
}

// Ежемесячная обработка ресурсов одной страны
function processEconomy(c) {
  const flow = countryResFlow(c.id);
  const cap = resCap(c);
  for (const k of RES_KEYS) c.res[k] = Math.min(cap, c.res[k] + flow.prod[k]);

  c.res.food -= flow.use.food;
  c.res.fuel -= flow.use.fuel;

  if (c.isAI) aiTrade(c, flow);

  const wasStarving = c.starving, hadNoFuel = c.noFuel;
  c.starving = c.res.food < 0;
  c.noFuel = c.res.fuel < 0;
  if (c.starving) c.res.food = 0;
  if (c.noFuel) c.res.fuel = 0;

  if (c.starving) {
    for (const pid of c.provinces) {
      const p = game.provinces[pid];
      p.troops = Math.max(5, Math.floor(p.troops * (1 - STARVE_LOSS)));
    }
  }

  if (c.id === game.playerId) {
    // заранее предупреждаем, что зерна осталось на 3 месяца или меньше
    const monthsLeft = flow.net.food < 0 ? c.res.food / -flow.net.food : Infinity;
    const low = !c.starving && monthsLeft <= 3;
    if (low && !c.foodWarned) pushToast(`🌾 Зерна хватит ещё примерно на ${Math.max(1, Math.floor(monthsLeft))} мес. Докупите на рынке.`, 'war');
    c.foodWarned = low;
    if (c.starving && !wasStarving) pushToast('🌾 ГОЛОД! Армия теряет людей. Купите продовольствие на рынке.', 'war');
    if (c.noFuel && !hadNoFuel) pushToast('🛢 Нет топлива: техника и авиация воюют вполсилы.', 'war');
    if (!c.starving && wasStarving) pushToast('🌾 Голод закончился.', 'good');
    if (!c.noFuel && hadNoFuel) pushToast('🛢 Топливо восстановлено.', 'good');
  }
}

// ---------------------------------------------------------------- Рынок
// dir: 'buy' | 'sell'; amount — сколько единиц ресурса (любое целое число). Возвращает true при успехе.
function marketCost(res, dir, amount) {
  const def = RES_DEFS[res];
  return dir === 'buy' ? Math.ceil(amount * def.buy) : Math.floor(amount * def.sell);
}

// Сколько можно купить / продать прямо сейчас (казна, склад, вместимость склада)
function marketMax(cid, res, dir) {
  const c = game.countries[cid];
  if (dir === 'buy') {
    return Math.max(0, Math.min(Math.floor(c.money / RES_DEFS[res].buy), Math.floor(resCap(c) - c.res[res])));
  }
  return Math.max(0, Math.floor(c.res[res]));
}

function marketTrade(cid, res, dir, amount = MARKET_LOT) {
  const c = game.countries[cid];
  amount = Math.floor(amount);
  if (!(amount >= 1)) return false;
  if (dir === 'buy') {
    const cost = marketCost(res, 'buy', amount);
    if (c.money < cost || c.res[res] + amount > resCap(c)) return false;
    c.money -= cost;
    c.res[res] += amount;
  } else {
    if (c.res[res] < amount) return false;
    c.res[res] -= amount;
    c.money += marketCost(res, 'sell', amount);
  }
  return true;
}

// Простая торговля ИИ: докупает нехватку, продаёт излишек
function aiTrade(c, flow) {
  const cap = resCap(c);
  const need = { food: flow.use.food * 3, fuel: flow.use.fuel * 3 };
  for (const k of ['food', 'fuel']) {
    if (c.res[k] < need[k] && c.res[k] < MARKET_LOT && c.money >= MARKET_LOT * RES_DEFS[k].buy + 60) {
      marketTrade(c.id, k, 'buy', MARKET_LOT);
    }
  }
  for (const k of RES_KEYS) {
    while (c.res[k] > cap * 0.6 && c.res[k] >= MARKET_LOT) marketTrade(c.id, k, 'sell', MARKET_LOT);
  }
}

// ---------------------------------------------------------------- Найм
// Найм единиц в провинции. Возвращает true, если куплено.
function buyUnits(cid, pid, type, amount) {
  const c = game.countries[cid];
  const p = game.provinces[pid];
  const def = UNIT_TYPES[type];
  if (!def || amount < 1 || !p || p.ownerId !== cid) return false;
  const cost = {
    money: Math.ceil(amount * def.cost.money),
    steel: Math.ceil(amount * def.cost.steel),
    fuel: Math.ceil(amount * def.cost.fuel)
  };
  if (c.money < cost.money || c.res.steel < cost.steel || c.res.fuel < cost.fuel) return false;
  c.money -= cost.money;
  c.res.steel -= cost.steel;
  c.res.fuel -= cost.fuel;
  p[def.key] = (p[def.key] || 0) + amount;
  return true;
}

function unitCostText(type, amount) {
  const def = UNIT_TYPES[type];
  const parts = [`${Math.ceil(amount * def.cost.money)}💰`];
  if (def.cost.steel) parts.push(`${Math.ceil(amount * def.cost.steel)}🔩`);
  if (def.cost.fuel) parts.push(`${Math.ceil(amount * def.cost.fuel)}🛢`);
  return parts.join(' ');
}

function canAffordUnits(cid, type, amount) {
  const c = game.countries[cid];
  const def = UNIT_TYPES[type];
  return c.money >= Math.ceil(amount * def.cost.money)
    && c.res.steel >= Math.ceil(amount * def.cost.steel)
    && c.res.fuel >= Math.ceil(amount * def.cost.fuel);
}
