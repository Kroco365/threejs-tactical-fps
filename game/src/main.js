// FOUNDRY PROTOCOL — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. main.js owns the round wiring, the player's shots,
// the spike channels and the buy flow; the modules own their own jobs.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE, NAMES } from './palette.js';
import { createGameState, PHASE, ROUND_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME, resetBomb } from './state.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { resolveHitscan, applyDamage, createTracers, explode } from './combat.js';
import { createRounds, SHOP } from './rounds.js';
import { createHud } from './hud.js';
import { sfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;
if (shot) Math.random = random; // deterministic captures: bots, bursts and spread all draw from the seeded stream

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 72);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createGameState();
const world = createWorld(scene);
const hud = createHud();
const player = createPlayer(world.colliders, world.spawns.player);
const weapons = createWeapons(camera, world.colliders);
const tracers = createTracers(scene);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpV = new THREE.Vector3();

// ---- the player's fighter: the shape combat.js understands ----
const playerFighter = {
  id: 'player', team: 'us', kind: 'player', name: 'YOU',
  position: player.state.position,
  eye: 1.6,
  health: 100,
  armor: 0,
  alive: true,
  hitMeshes: [],
  onDamage(amount, attacker) {
    hud.damageFlash(attacker ? damageAngle(attacker.position) : null);
    sfx.hurt();
    if (player.state.position && state.bomb.plantBy === 'player') {
      state.bomb.plantProgress = 0;
      state.bomb.plantBy = null;
    }
  },
  onDeath(attacker) {
    state.deaths += 1;
    if (state.bomb.carrier === 'player') passBomb();
    hud.banner('YOU ARE DOWN', 'Your team fights on.', 3500);
    if (document.pointerLockElement) document.exitPointerLock();
  },
};

function damageAngle(fromPos) {
  const dx = fromPos.x - player.state.position.x;
  const dz = fromPos.z - player.state.position.z;
  const worldAngle = Math.atan2(dx, dz);
  const rel = worldAngle - player.state.yaw;
  return ((rel * 180) / Math.PI + 360) % 360;
}

function allFighters() {
  return [playerFighter, ...bots.bots];
}

function shootables() {
  const list = world.shootables.slice(); // copy: fighter meshes must not accumulate on the shared array
  for (const f of allFighters()) {
    if (f.alive) for (const m of f.hitMeshes) list.push(m);
  }
  return list;
}

// ---- bots ----
const bots = createBots(scene, world, {
  shootables: () => shootables(),
  bombState: () => state.bomb,
  onBotShot(bot, origin, dir) {
    const dist = origin.distanceTo(player.state.position);
    sfx.shot('rifle', Math.min(1, dist / 55));
    tracers.spawn(origin, tmpV.copy(origin).addScaledVector(dir, 40), 0xff8a5a);
  },
  onBotHit(bot, target, part, killed) {
    // a bot hit something: only the player's pain is shown here
    if (target === playerFighter) hud.setHealth(playerFighter.health, weapons.state.armor);
  },
  onKill(attacker, victim, part) {
    const killerName = attacker === playerFighter ? 'YOU' : attacker.name;
    const victimName = victim === playerFighter ? 'YOU' : victim.name;
    hud.killfeed(killerName, victimName, part === 'head', attacker.team);
    if (attacker === playerFighter) {
      rounds.killReward();
      sfx.kill();
      hud.hitMarker(true, 140);
    }
    if (victim === playerFighter) {
      // handled by playerFighter.onDeath
    } else if (victim.hasBomb) {
      victim.hasBomb = false;
      victim.planting = false;
      passBombToAlly(victim);
    }
    if (victim.kind === 'bot') {
      victim.group.visible = true; // the fall animation plays in bots.step
    }
  },
  onBotPlant(bot, site) {
    if (state.bomb.carrier !== 'planted' && state.phase === PHASE.LIVE) {
      state.bomb.plantBy = bot;
      state.bomb.site = site;
      state.bomb.plantProgress = 0;
      hud.hint(`${bot.name} is planting the spike at ${site === 'A' ? NAMES.siteA : NAMES.siteB}!`, 3000);
    }
  },
  onBotDefuse(bot, progress) {
    state.bomb.defuseBy = bot;
    state.bomb.defuseProgress = progress;
  },
  onDefused(bot) {
    if (state.phase === PHASE.LIVE && state.bomb.carrier === 'planted') {
      rounds.endRound('them', `${bot.name} defused the spike.`);
    }
  },
});

function passBomb() {
  state.bomb.carrier = 'gone';
  passBombToAlly(null);
}

function passBombToAlly(deadBot) {
  const living = bots.bots.filter((b) => b.alive && b.team === 'us' && b !== deadBot);
  if (living.length) {
    bots.giveBomb(living[0]);
    state.bomb.carrier = 'ally';
  } else {
    state.bomb.carrier = 'gone';
  }
}

function aliveCounts() {
  let us = playerFighter.alive ? 1 : 0;
  let them = 0;
  for (const b of bots.bots) {
    if (!b.alive) continue;
    if (b.team === 'us') us += 1;
    else them += 1;
  }
  return { us, them };
}

// ---- rounds ----
const rounds = createRounds(state, {
  onRoundStart(round) {
    // reset the field
    player.reset(world.spawns.player, 0);
    const survived = playerFighter.alive;
    playerFighter.health = 100;
    playerFighter.alive = true;
    playerFighter.eye = 1.6;
    weapons.resetRound(survived);
    playerFighter.armor = weapons.state.armor;
    const assignments = {};
    const allyRoutes = [
      ['atkSpawn', 'aMain1', 'aMain2', 'mid2', 'atkSpawn'],
      ['atkSpawn', 'bMain1', 'bMain2', 'mid2', 'atkSpawn'],
    ];
    const allies = bots.bots.filter((b) => b.team === 'us');
    allies.forEach((b, i) => {
      assignments[b.id] = { patrol: allyRoutes[i % allyRoutes.length] };
    });
    const enemies = bots.bots.filter((b) => b.team === 'them');
    const defSetup = round % 2 === 1
      ? [
        { anchor: 'aSite', patrol: ['aSite', 'aBack', 'aSite'] },
        { anchor: 'aSite', patrol: ['aSite', 'connW', 'aSite'] },
        { anchor: 'bSite', patrol: ['bSite', 'bBack', 'bSite'] },
        { anchor: 'mid3', patrol: ['mid3', 'mid2', 'connE', 'mid3'] },
      ]
      : [
        { anchor: 'aSite', patrol: ['aSite', 'aBack', 'aSite'] },
        { anchor: 'bSite', patrol: ['bSite', 'bBack', 'bSite'] },
        { anchor: 'bSite', patrol: ['bSite', 'connE', 'bSite'] },
        { anchor: 'mid3', patrol: ['mid3', 'mid2', 'connW', 'mid3'] },
      ];
    enemies.forEach((b, i) => {
      assignments[b.id] = defSetup[i % defSetup.length];
    });
    const spawns = {};
    allies.forEach((b, i) => { spawns[b.id] = world.spawns.allies[i]; });
    enemies.forEach((b, i) => { spawns[b.id] = world.spawns.enemies[i]; });
    bots.reset(spawns, assignments);
    state.bomb.carrier = 'player';
    hud.setHealth(100, 0);
    hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
    hud.setMoney(state.money);
    hud.setScore(state.winsUs, state.winsThem, state.round);
    hud.bombStatus(null, 0);
    hud.hint('Press B to buy — round starts in 12s', 4000);
  },
  onRoundEnd(winner, reason) {
    hud.banner(state.endText, state.endSub, 3800);
    if (winner === 'us') sfx.roundWin();
    else sfx.roundLose();
    hud.hideBuy();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner) {
    hud.showOverlay('matchEnd', {
      title: winner === 'us' ? 'MATCH WON' : 'MATCH LOST',
      copy: `Final score ${state.winsUs} — ${state.winsThem}. ${state.stats.hits} hits from ${state.stats.shots} shots, ${state.stats.headshots} headshots.`,
      action: 'Play again',
    });
  },
  onMoney(money) {
    hud.setMoney(money);
  },
});

// ---- input ----
let suppressPause = false;
let frozen = false;
let started = false;
const input = createInput(renderer.domElement, onLockChange);

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.hideBuy();
  } else if (suppressPause) {
    suppressPause = false;
  } else if (state.phase === PHASE.MATCH_END) {
    // overlay already shown by onMatchEnd
  } else if (!playerFighter.alive) {
    hud.showOverlay('paused', {
      title: 'YOU ARE DOWN',
      copy: 'Your team fights on. Click to keep watching from here.',
      action: 'Keep watching',
    });
  } else if (state.phase !== PHASE.MENU) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (state.phase === PHASE.MENU || state.phase === PHASE.MATCH_END) rounds.startMatch();
  input.requestLock();
});

// ---- shooting ----
let prevFiring = false;
let shake = 0;

function tryShoot() {
  if (state.phase !== PHASE.LIVE || !playerFighter.alive) return;
  const def = weapons.def();
  const auto = def.auto;
  if (!auto && prevFiring) return;
  if (!weapons.ready()) {
    if (weapons.ammo[weapons.state.current].mag === 0) {
      sfx.dryFire();
      weapons.reload();
    }
    return;
  }
  if (!weapons.takeRound()) return;
  state.stats.shots += 1;
  camera.getWorldDirection(direction);
  const speed = player.groundSpeed();
  const spread = weapons.spread(speed, speed > 0.5);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  const origin = camera.position;
  const result = resolveHitscan(origin, direction, def, shootables());
  muzzle.copy(origin).addScaledVector(direction, 0.6);
  muzzle.x += 0.18;
  muzzle.y -= 0.12;
  if (result) {
    tracers.spawn(muzzle, result.point, 0xffd27a);
    if (result.fighter) {
      state.stats.hits += 1;
      if (result.part === 'head') state.stats.headshots += 1;
      state.stats.damage += result.damage;
      const killed = applyDamage(result.fighter, result.damage, result.part, playerFighter, onKillLocal);
      hud.hitMarker(killed, killed ? 140 : 90);
      sfx.hit();
      if (killed) hud.setScore(state.winsUs, state.winsThem, state.round);
    }
  } else {
    tracers.spawn(muzzle, tmpV.copy(origin).addScaledVector(direction, def.range), 0xffd27a);
  }
  weapons.pullTrigger();
  player.recoil(def.kick * (1 + weapons.state.bloom * 8), (random() * 2 - 1) * def.kick * 0.4);
  sfx.shot(def.kind, 0);
  bots.hearShot(player.state.position, 'us');
  shake = Math.min(0.02, shake + def.kind === 'sniper' ? 0.02 : 0.006);
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, def.name, weapons.state.grenades);
}

function onKillLocal(attacker, victim, part) {
  const killerName = attacker === playerFighter ? 'YOU' : attacker.name;
  const victimName = victim === playerFighter ? 'YOU' : victim.name;
  hud.killfeed(killerName, victimName, part === 'head', attacker.team);
  if (attacker === playerFighter) {
    rounds.killReward();
    sfx.kill();
  }
  if (victim.hasBomb) {
    victim.hasBomb = false;
    victim.planting = false;
    passBombToAlly(victim);
  }
}

function throwGrenade() {
  if (state.phase !== PHASE.LIVE || !playerFighter.alive) return;
  camera.getWorldDirection(direction);
  const ok = weapons.throwGrenade(camera.position, direction, (position) => {
    sfx.explosion(position.distanceTo(player.state.position) / 40);
    shake = 0.03;
    explode(position, {
      radius: 6, maxDamage: 120, minDamage: 20,
      fighters: allFighters(), world, attacker: playerFighter, onKill: onKillLocal,
    });
  });
  if (ok) sfx.grenadePin();
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
}

// ---- buy menu ----
function toggleBuy() {
  if (state.phase !== PHASE.FREEZE || !playerFighter.alive) return;
  if (hud.isBuyOpen()) {
    hud.hideBuy();
    input.requestLock();
  } else {
    suppressPause = true;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showBuy(SHOP, state.money, (id) => buyItem(id));
  }
}

function buyItem(id) {
  let cost = null;
  if (id === 'grenade') cost = weapons.buyGrenade(state.money);
  else if (id === 'armor') cost = weapons.buyArmor(state.money);
  else cost = weapons.buy(id, state.money);
  if (cost === null) {
    sfx.denied();
    return;
  }
  state.money -= cost;
  hud.setMoney(state.money);
  sfx.buy();
  if (id === 'armor') playerFighter.armor = weapons.state.armor;
  if (id !== 'grenade' && id !== 'armor') weapons.switchTo(id);
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
  hud.setHealth(playerFighter.health, weapons.state.armor);
}

// ---- bomb channels ----
function siteAt(position) {
  for (const [name, site] of Object.entries(world.sites)) {
    if (position.x >= site.minX && position.x <= site.maxX && position.z >= site.minZ && position.z <= site.maxZ) return name;
  }
  return null;
}

function stepBomb(dt) {
  const bomb = state.bomb;
  // the player's plant channel: hold E inside a site while carrying the spike
  if (bomb.carrier === 'player' && state.phase === PHASE.LIVE && playerFighter.alive) {
    const site = siteAt(player.state.position);
    if (site && input.state.keys.has('KeyE')) {
      if (bomb.plantBy !== 'player') {
        bomb.plantBy = 'player';
        bomb.site = site;
        bomb.plantProgress = 0;
        sfx.plant();
      }
      if (player.groundSpeed() < 0.5) {
        bomb.plantProgress += dt / PLANT_TIME;
        if (Math.floor(bomb.plantProgress * PLANT_TIME) !== Math.floor((bomb.plantProgress - dt / PLANT_TIME) * PLANT_TIME)) sfx.beep();
        if (bomb.plantProgress >= 1) plantBomb(site);
      } else {
        bomb.plantProgress = 0;
        bomb.plantBy = null;
      }
    } else if (bomb.plantBy === 'player') {
      bomb.plantProgress = 0;
      bomb.plantBy = null;
    }
  }
  // an ally bot's plant channel
  if (bomb.plantBy && bomb.plantBy !== 'player' && bomb.carrier !== 'planted') {
    const bot = bomb.plantBy;
    if (!bot.alive || !bot.planting || !siteAt(bot.position)) {
      bomb.plantProgress = 0;
      bomb.plantBy = null;
      bot.planting = false;
    } else {
      bomb.plantProgress += dt / PLANT_TIME;
      if (bomb.plantProgress >= 1) plantBomb(bomb.site);
    }
  }
  // HUD: planted fuse, plant/defuse progress
  if (bomb.carrier === 'planted') {
    const elapsed = ROUND_TIME - state.roundTime - bomb.plantedAt;
    const left = Math.max(0, BOMB_FUSE - elapsed);
    hud.bombStatus(`SPIKE PLANTED · ${bomb.site === 'A' ? NAMES.siteA : NAMES.siteB} · ${left.toFixed(0)}s`, left / BOMB_FUSE);
  } else if (bomb.plantBy) {
    hud.bombStatus(`PLANTING ${bomb.site === 'A' ? NAMES.siteA : NAMES.siteB}…`, bomb.plantProgress);
  } else if (bomb.defuseBy && bomb.defuseProgress > 0) {
    hud.bombStatus(`ENEMY DEFUSING…`, bomb.defuseProgress);
  } else if (bomb.carrier === 'player' && state.phase === PHASE.LIVE) {
    const site = siteAt(player.state.position);
    hud.bombStatus(site ? `HOLD E TO PLANT · ${site === 'A' ? NAMES.siteA : NAMES.siteB}` : 'CARRYING THE SPIKE — reach a site', 0);
  } else {
    hud.bombStatus(null, 0);
  }
}

function plantBomb(site) {
  const bomb = state.bomb;
  const planter = bomb.plantBy;
  bomb.carrier = 'planted';
  bomb.site = site;
  bomb.plantedAt = ROUND_TIME - state.roundTime;
  bomb.position = planter === 'player'
    ? player.state.position.clone()
    : planter.position.clone();
  bomb.plantProgress = 0;
  bomb.plantBy = null;
  if (planter === 'player') rounds.plantReward();
  hud.banner('SPIKE PLANTED', `${site === 'A' ? NAMES.siteA : NAMES.siteB} · ${BOMB_FUSE}s to detonation`, 3000);
  sfx.beep(true);
}

// ---- per-frame input edges ----
function handlePresses(presses) {
  for (const code of presses) {
    if (code === 'KeyB') { toggleBuy(); continue; }
    if (hud.isBuyOpen()) {
      const item = SHOP.find((s) => `Digit${s.key}` === code || `Numpad${s.key}` === code);
      if (item) buyItem(item.id);
      continue;
    }
    if (code === 'Digit1') weapons.switchTo('pistol');
    else if (code === 'Digit2') weapons.switchTo('rifle');
    else if (code === 'Digit3') weapons.switchTo('smg');
    else if (code === 'Digit4') weapons.switchTo('sniper');
    else if (code === 'KeyR') { if (weapons.reload()) sfx.reload(); }
    else if (code === 'KeyG') throwGrenade();
    if (code.startsWith('Digit')) {
      hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, weapons.def().name, weapons.state.grenades);
    }
  }
}

// ---- simulation step ----
let elapsed = 0;
let stepCount = 0;
let footAcc = 0;

function step(dt) {
  elapsed += dt;
  stepCount += 1;
  const phase = state.phase;
  if (phase === PHASE.LIVE || phase === PHASE.FREEZE) {
    if (playerFighter.alive) player.step(dt, input.state.keys);
    playerFighter.eye = player.state.eye;
    playerFighter.armor = weapons.state.armor;
  }
  weapons.step(dt);
  tracers.step(dt);
  if (phase === PHASE.LIVE) {
    bots.step(dt, allFighters());
    stepBomb(dt);
  }
  // a dead defuser leaves no progress behind
  if (state.bomb.defuseBy && (!state.bomb.defuseBy.alive || state.bomb.defuseBy.defuseProgress <= 0)) {
    state.bomb.defuseBy = null;
    state.bomb.defuseProgress = 0;
  }
  rounds.tick(dt, aliveCounts());
  // footsteps
  if (playerFighter.alive && (phase === PHASE.LIVE || phase === PHASE.FREEZE)) {
    footAcc += player.groundSpeed() * dt;
    if (footAcc > 2.4) {
      footAcc = 0;
      if (player.groundSpeed() > 0.5) sfx.step(player.groundSpeed() > 4);
    }
  }
  // HUD numbers
  hud.setHealth(Math.ceil(playerFighter.health), weapons.state.armor);
  hud.setTimer(phase === PHASE.FREEZE ? state.freezeTime : state.roundTime, phase);
  hud.setScore(state.winsUs, state.winsThem, state.round);
  const alive = aliveCounts();
  hud.setAlive(alive.us, alive.them);
  const scoped = input.state.aiming && weapons.def().kind === 'sniper' && playerFighter.alive;
  weapons.state.scoped = scoped;
  const spreadPx = 10 + weapons.spread(player.groundSpeed(), player.groundSpeed() > 0.5) * 900;
  hud.setCrosshair(scoped ? 0 : spreadPx, scoped);
  shake = Math.max(0, shake - dt * 0.05);
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.rotation.x += (random() * 2 - 1) * shake * 0.3;
    camera.rotation.y += (random() * 2 - 1) * shake * 0.3;
  }
  const targetFov = weapons.state.scoped ? 74 * WEAPONS.sniper.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerFighter.alive && (state.phase === PHASE.LIVE || state.phase === PHASE.FREEZE)) {
      player.look(look.x, look.y);
    }
    handlePresses(input.takePresses());
    if (input.state.firing) tryShoot();
    prevFiring = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  rounds.startMatch();
  state.phase = PHASE.LIVE;
  if (name === 'start') {
    player.reset(world.spawns.player, 0);
    playerFighter.health = 100;
    playerFighter.alive = true;
    settle(30);
    aimAt(new THREE.Vector3(0, 1.6, -12));
    hud.showOverlay('start');
  } else if (name === 'play') {
    player.reset(new THREE.Vector3(0, 0, 7), 0);
    const enemies = bots.bots.filter((b) => b.team === 'them');
    enemies[0].position.set(0.5, 0, -3);
    enemies[1].position.set(3.5, 0, -5);
    enemies[0].group.position.copy(enemies[0].position);
    enemies[1].group.position.copy(enemies[1].position);
    settle(30);
    aimAt(new THREE.Vector3(enemies[0].position.x, 1.2, enemies[0].position.z));
    for (let i = 0; i < 3; i += 1) {
      tryShoot();
      settle(6);
    }
    settle(10);
  } else {
    // end: round won, one enemy down in front of the player
    player.reset(new THREE.Vector3(-14, 0, -6), 0.25);
    const enemies = bots.bots.filter((b) => b.team === 'them');
    enemies[0].position.set(-15, 0, -10);
    enemies[0].alive = false;
    enemies[0].fall = 1;
    enemies[0].group.rotation.x = -1.45;
    enemies[0].group.position.copy(enemies[0].position);
    state.winsUs = 2;
    state.winsThem = 1;
    settle(20);
    hud.banner('ROUND WON', 'Enemy team eliminated.', 60000);
    hud.setScore(2, 1, 3);
  }
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = { state, playerFighter, bots, weapons, rounds, world, input };
// test hooks for the local Playwright harness: advance the fixed-step sim
// without waiting on the renderer, fire one shot, and feed one key press.
// They do not change the game; they only let a slow software renderer test it.
window.__game.stepSim = (seconds) => {
  const n = Math.max(0, Math.round(seconds / FIXED_STEP));
  for (let i = 0; i < n; i += 1) step(FIXED_STEP);
  syncCamera();
};
window.__game.shootOnce = () => { prevFiring = false; tryShoot(); }; // one fresh trigger pull per call
window.__game.press = (code) => { handlePresses([code]); };

syncCamera();
hud.setAmmo(30, 90, 'P9 SIDEARM', 0);
hud.setMoney(state.money);
hud.setScore(0, 0, 1);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
