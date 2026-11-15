// Rounds and money. One round: a buy freeze, live play against the clock, then a
// win by elimination, by the spike going off, or by a defuse. The round state
// machine lives here; main.js feeds it the alive counts and the bomb each tick.
// Money: kills and plants pay at once, the round bonus pays at the end.
import {
  PHASE, ROUND_TIME, FREEZE_TIME, BOMB_FUSE, ROUNDS_TO_WIN, MAX_ROUNDS,
  WIN_BONUS, LOSS_BONUS, KILL_BONUS, PLANT_BONUS, START_MONEY, resetBomb,
} from './state.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

export const SHOP = [
  { id: 'rifle', name: 'VANDAL-7 rifle', detail: 'Auto · 33 dmg · 30 rounds', price: WEAPONS.rifle.price, key: '2' },
  { id: 'smg', name: 'STINGER-9 SMG', detail: 'Auto · 26 dmg · fast', price: WEAPONS.smg.price, key: '3' },
  { id: 'sniper', name: 'LONGSHOT', detail: 'Bolt · 115 dmg · scope on right-click', price: WEAPONS.sniper.price, key: '4' },
  { id: 'grenade', name: 'HE grenade', detail: 'Throw with G · 120 max damage', price: GRENADE_PRICE, key: '5' },
  { id: 'armor', name: 'Kevlar vest', detail: 'Absorbs half of damage · 50 points', price: ARMOR_PRICE, key: '6' },
];

export function createRounds(state, hooks) {
  function setPhase(phase) {
    state.phase = phase;
  }

  function startMatch() {
    state.round = 1;
    state.winsUs = 0;
    state.winsThem = 0;
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = null;
    state.stats = { shots: 0, hits: 0, headshots: 0, damage: 0 };
    startRound();
  }

  function startRound() {
    resetBomb(state);
    state.roundTime = ROUND_TIME;
    state.freezeTime = FREEZE_TIME;
    state.roundKills = 0;
    state.plantedThisRound = false;
    setPhase(PHASE.FREEZE);
    hooks.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
    const won = winner === 'us';
    if (won) state.winsUs += 1;
    else state.winsThem += 1;
    state.money += won ? WIN_BONUS : LOSS_BONUS;
    state.endText = won ? 'ROUND WON' : 'ROUND LOST';
    state.endSub = reason;
    state.endTimer = 4;
    setPhase(PHASE.ROUND_END);
    hooks.onRoundEnd(winner, reason);
    if (state.winsUs >= ROUNDS_TO_WIN || state.winsThem >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.winsUs > state.winsThem ? 'us' : 'them';
      state.endText = state.matchWinner === 'us' ? 'MATCH WON' : 'MATCH LOST';
      state.endSub = `${state.winsUs} — ${state.winsThem} · ${reason}`;
      state.endTimer = 6;
      setPhase(PHASE.MATCH_END);
      hooks.onMatchEnd(state.matchWinner);
    }
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function tick(dt, alive) {
    if (state.phase === PHASE.FREEZE) {
      state.freezeTime -= dt;
      if (state.freezeTime <= 0) setPhase(PHASE.LIVE);
      return;
    }
    if (state.phase === PHASE.ROUND_END) {
      state.endTimer -= dt;
      if (state.endTimer <= 0) nextRound();
      return;
    }
    if (state.phase === PHASE.MATCH_END) {
      state.endTimer -= dt;
      return;
    }
    if (state.phase !== PHASE.LIVE) return;
    state.roundTime -= dt;
    if (state.bomb.carrier === 'planted') {
      const elapsed = ROUND_TIME - state.roundTime - state.bomb.plantedAt;
      if (elapsed >= BOMB_FUSE) {
        endRound('us', 'The spike detonated.');
        return;
      }
    }
    if (state.roundTime <= 0) {
      endRound(state.bomb.carrier === 'planted' ? 'us' : 'them', state.bomb.carrier === 'planted' ? 'Time ran out after the plant.' : 'Time ran out — the spike was never planted.');
      return;
    }
    if (alive.us === 0 && alive.them > 0) {
      endRound('them', 'Your team was eliminated.');
      return;
    }
    if (alive.them === 0 && alive.us > 0) {
      endRound('us', state.bomb.carrier === 'planted' ? 'Defenders eliminated after the plant.' : 'Enemy team eliminated.');
    }
  }

  return {
    startMatch,
    startRound,
    endRound,
    tick,
    addMoney(amount) {
      state.money += amount;
      hooks.onMoney(state.money);
    },
    killReward() {
      state.money += KILL_BONUS;
      state.kills += 1;
      state.roundKills += 1;
      hooks.onMoney(state.money);
    },
    plantReward() {
      state.money += PLANT_BONUS;
      state.plantedThisRound = true;
      hooks.onMoney(state.money);
    },
  };
}
