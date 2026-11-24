'use strict';
/* ГЕГЕМОН — Типы войск и боевая сила
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Армия провинции или марша — объект { troops, tanks, air }:
     troops — пехота (поле называется так исторически), tanks — бронетехника, air — авиация.
   «Сила» — единая мера: пехота = 1, танк = TANK_POWER, самолёт = AIR_POWER. */

const TANK_POWER = 8;
const AIR_POWER = 12;
const NO_FUEL_MULT = 0.5;     // без топлива техника воюет вполсилы
const AIR_FORT_PIERCE = 0.6;  // доля бонуса фортов, которую авиация «обходит»
const MOBILE_SPEED_BONUS = 0.35; // насколько быстрее идёт техника, чем пехота

// Цена найма одной единицы (деньги и ресурсы)
const UNIT_TYPES = {
  inf:  { key: 'troops', icon: '🪖', name: 'Пехота',       power: 1,          cost: { money: 1.2, steel: 0,   fuel: 0 } },
  tank: { key: 'tanks',  icon: '🚜', name: 'Бронетехника', power: TANK_POWER, cost: { money: 18,  steel: 2,   fuel: 1 } },
  air:  { key: 'air',    icon: '✈️', name: 'Авиация',      power: AIR_POWER,  cost: { money: 40,  steel: 3,   fuel: 2 } }
};
// Расход топлива в месяц на единицу
const FUEL_UPKEEP = { tanks: 0.1, air: 0.25 };

function emptyArmy() { return { troops: 0, tanks: 0, air: 0 }; }

function armyOf(src) {
  return { troops: src.troops || 0, tanks: src.tanks || 0, air: src.air || 0 };
}

// Сила армии. ownerId нужен, чтобы учесть нехватку топлива у владельца.
function armyPower(a, ownerId) {
  const k = ownerId !== undefined && ownerId !== null && game.countries[ownerId] && game.countries[ownerId].noFuel ? NO_FUEL_MULT : 1;
  return (a.troops || 0) + ((a.tanks || 0) * TANK_POWER + (a.air || 0) * AIR_POWER) * k;
}

// Номинальная сила (без штрафов) — для интерфейса и счётчиков
function rawPower(a) {
  return (a.troops || 0) + (a.tanks || 0) * TANK_POWER + (a.air || 0) * AIR_POWER;
}

function provPower(p) { return rawPower(p); }

function scaleArmy(a, ratio) {
  return {
    troops: Math.floor((a.troops || 0) * ratio),
    tanks: Math.floor((a.tanks || 0) * ratio),
    air: Math.floor((a.air || 0) * ratio)
  };
}

function addArmy(target, a) {
  target.troops = (target.troops || 0) + (a.troops || 0);
  target.tanks = (target.tanks || 0) + (a.tanks || 0);
  target.air = (target.air || 0) + (a.air || 0);
}

function armyBreakdownText(a) {
  const parts = [`🪖 ${fmtNum(a.troops || 0)}`];
  if (a.tanks > 0) parts.push(`🚜 ${fmtNum(a.tanks)}`);
  if (a.air > 0) parts.push(`✈️ ${fmtNum(a.air)}`);
  return parts.join(' ');
}

// Половина армии провинции (для передач по мирному договору/ультиматуму), пехоты не меньше minTroops
function halfArmy(p, minTroops = 0) {
  const a = scaleArmy(p, 0.5);
  a.troops = Math.max(minTroops, a.troops);
  return a;
}
