// One place for the match state. Nothing else owns round phase, money, score or
// the bomb; modules read this and main.js advances it. All times are seconds.
export const PHASE = {
  MENU: 'menu', // overlay up, waiting for the player to click in
  FREEZE: 'freeze', // buy time at the start of a round
  LIVE: 'live', // the round is being played
  ROUND_END: 'roundEnd', // banner up, short pause, then the next round
  MATCH_END: 'matchEnd', // one team reached the target
};

export const ROUND_TIME = 100;
export const FREEZE_TIME = 12;
export const BOMB_FUSE = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const ROUNDS_TO_WIN = 5;
export const MAX_ROUNDS = 9;
export const START_MONEY = 800;
export const WIN_BONUS = 3250;
export const LOSS_BONUS = 1900;
export const KILL_BONUS = 300;
export const PLANT_BONUS = 300;

export function createGameState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    winsUs: 0,
    winsThem: 0,
    roundTime: ROUND_TIME,
    freezeTime: FREEZE_TIME,
    endTimer: 0,
    endText: '',
    endSub: '',
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    bomb: {
      carrier: 'player', // 'player' | 'ally' | 'enemy' | 'planted' | 'gone'
      site: null, // 'A' | 'B' | null
      plantedAt: 0, // elapsed seconds when planted
      plantProgress: 0, // 0..1 while a plant channel runs
      plantBy: null, // who is planting
      defuseProgress: 0, // 0..1 while a defuse channel runs
      defuseBy: null,
      position: null, // THREE.Vector3 while planted
    },
    matchWinner: null, // 'us' | 'them' | null
    // per-round bookkeeping, reset by rounds.startRound
    roundKills: 0,
    plantedThisRound: false,
    stats: { shots: 0, hits: 0, headshots: 0, damage: 0 },
  };
}

export function resetBomb(state) {
  state.bomb.carrier = 'player';
  state.bomb.site = null;
  state.bomb.plantedAt = 0;
  state.bomb.plantProgress = 0;
  state.bomb.plantBy = null;
  state.bomb.defuseProgress = 0;
  state.bomb.defuseBy = null;
  state.bomb.position = null;
}
