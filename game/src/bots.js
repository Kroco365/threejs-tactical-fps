// The other six soldiers on the map. Each bot is a fighter with a small state
// machine: HOLD an anchor, PATROL a lane, ROTATE to a threatened site, PUSH the
// planted bomb, DEFUSE it, ENGAGE what it sees, INVESTIGATE what it hears.
// Perception is a staggered line-of-sight raycast; hearing is a radius around
// a gunshot. Bots move with the same axis-separated box collision as the player
// and route on the world's waypoint graph (BFS). They fire in bursts with a
// reaction time and an aim error that shrinks the longer they hold a target.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { resolveHitscan, applyDamage } from './combat.js';

const BOT_SPEED = 4.2;
const EYE = 1.55;
const RADIUS = 0.34;
const HEIGHT = 1.72;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.7;
const SIGHT_RANGE = 55;
const HEAR_RANGE = 25;
const BOT_DAMAGE = 20;
const BOT_HEAD_MULT = 2;

const BOT_RIFLE = {
  id: 'bot-rifle', name: 'EMBER CARBINE', kind: 'rifle', auto: true,
  damage: BOT_DAMAGE, headMult: BOT_HEAD_MULT, fireGap: 0.13,
  spreadStill: 0.006, spreadMove: 0.02, range: 80, falloffAt: 30,
};

function bfsPath(nodes, adjacency, fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency[cur] || []) {
      if (prev[next] === undefined) {
        prev[next] = cur;
        if (next === toId) {
          const path = [toId];
          let node = toId;
          while (prev[node] !== null) {
            node = prev[node];
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [fromId];
}

function nearestNode(nodes, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, [nx, nz]] of Object.entries(nodes)) {
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function createBots(scene, world, hooks) {
  const { nodes, adjacency } = world.waypoints;
  const colliders = world.colliders;
  const bots = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = SIGHT_RANGE;
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const probe = new THREE.Box3();
  let clock = 0;

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.55, metalness: 0.15 });
  const enemyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.55, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22252a'), roughness: 0.8, metalness: 0.1 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#111111'), emissive: new THREE.Color(PALETTE.hazard), emissiveIntensity: 1.4, roughness: 0.3 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);
  const stripeGeo = new THREE.BoxGeometry(0.54, 0.08, 0.32);

  function buildMesh(team) {
    const group = new THREE.Group();
    const stripeMat = team === 'us' ? allyMat : enemyMat;
    const torso = new THREE.Mesh(torsoGeo, darkMat);
    torso.position.y = 1.02;
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 1.18;
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.y = 1.56;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), visorMat);
    visor.position.set(0, 1.58, -0.15);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.14, 0.36, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.14, 0.36, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.18, 1.12, -0.35);
    group.add(torso, stripe, head, visor, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group, torso, head };
  }

  function makeBot(id, team, name, spawn, anchorNode) {
    const { group, torso, head } = buildMesh(team);
    group.position.copy(spawn);
    scene.add(group);
    const bot = {
      id, team, name, kind: 'bot',
      group, torso, head,
      position: spawn.clone(),
      velocity: new THREE.Vector3(),
      yaw: team === 'us' ? 0 : Math.PI,
      pitch: 0,
      eye: EYE,
      health: 100,
      armor: 0,
      alive: true,
      state: 'hold',
      anchorNode,
      patrolRoute: null,
      patrolIndex: 0,
      path: [],
      pathIndex: 0,
      target: null,
      lastSeen: new THREE.Vector3(),
      lastSeenTime: -99,
      seenAt: -99,
      reactionAt: 0,
      burstLeft: 0,
      burstTimer: 0,
      pauseTimer: 0,
      strafeDir: 1,
      strafeUntil: 0,
      hearPos: null,
      hearTime: -99,
      stuckTimer: 0,
      lastProgress: spawn.clone(),
      aimError: 0.06,
      timeOnTarget: 0,
      fall: 0,
      hasBomb: false,
      planting: false,
      plantProgress: 0,
      defuseProgress: 0,
      thinkAt: Math.random() * 0.15,
    };
    torso.userData.part = 'torso';
    head.userData.part = 'head';
    torso.userData.fighter = bot;
    head.userData.fighter = bot;
    // taking a hit breaks a plant or a defuse channel
    bot.onDamage = () => {
      bot.defuseProgress = 0;
      bot.planting = false;
    };
    bot.hitMeshes = [torso, head];
    bots.push(bot);
    return bot;
  }

  // the roster: two VANGUARD allies, four EMBER defenders
  makeBot('ally1', 'us', 'FLINT', world.spawns.allies[0], 'aMain1');
  makeBot('ally2', 'us', 'JUNO', world.spawns.allies[1], 'bMain1');
  makeBot('ember1', 'them', 'ASH', world.spawns.enemies[0], 'aSite');
  makeBot('ember2', 'them', 'CINDER', world.spawns.enemies[1], 'aSite');
  makeBot('ember3', 'them', 'SLAG', world.spawns.enemies[2], 'bSite');
  makeBot('ember4', 'them', 'RUST', world.spawns.enemies[3], 'mid3');

  function overlaps(x, z) {
    probe.min.set(x - RADIUS, 0.02, z - RADIUS);
    probe.max.set(x + RADIUS, HEIGHT - 0.02, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    const nx = bot.position.x + vx * dt;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + vz * dt;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    return len < 0.6;
  }

  function routeTo(bot, nodeId) {
    const from = nearestNode(nodes, bot.position.x, bot.position.z);
    const ids = bfsPath(nodes, adjacency, from, nodeId);
    bot.path = ids.map((id) => new THREE.Vector3(nodes[id][0], 0, nodes[id][1]));
    bot.pathIndex = 0;
  }

  function followPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const wp = bot.path[bot.pathIndex];
    if (moveToward(bot, wp.x, wp.z, dt, speed)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  function canSee(bot, fighter) {
    if (!fighter.alive) return false;
    tmpEye.set(bot.position.x, bot.position.y + bot.eye, bot.position.z);
    tmpTarget.set(fighter.position.x, fighter.position.y + 1.2, fighter.position.z);
    tmpDir.copy(tmpTarget).sub(tmpEye);
    const dist = tmpDir.length();
    if (dist > SIGHT_RANGE) return false;
    tmpDir.normalize();
    raycaster.set(tmpEye, tmpDir);
    const hits = raycaster.intersectObjects(hooks.shootables(), false);
    return hits.length === 0 || hits[0].distance >= dist - 0.3;
  }

  function nearestVisibleEnemy(bot, fighters) {
    let best = null;
    let bestD = Infinity;
    for (const f of fighters) {
      if (f.team === bot.team || !f.alive) continue;
      const d = bot.position.distanceToSquared(f.position);
      if (d < bestD && canSee(bot, f)) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  function botShoot(bot, target) {
    tmpEye.set(bot.position.x, bot.position.y + bot.eye, bot.position.z);
    // pick the aim height (chest, or head on a lucky bias) BEFORE the direction
    const headBias = Math.random() < 0.12;
    tmpTarget.set(target.position.x, target.position.y + (headBias ? 1.55 : 1.15), target.position.z);
    tmpDir.copy(tmpTarget).sub(tmpEye);
    tmpDir.normalize();
    const err = bot.aimError * (0.5 + Math.random());
    tmpDir.x += (Math.random() * 2 - 1) * err;
    tmpDir.y += (Math.random() * 2 - 1) * err * 0.7;
    tmpDir.z += (Math.random() * 2 - 1) * err;
    tmpDir.normalize();
    const result = resolveHitscan(tmpEye, tmpDir, BOT_RIFLE, hooks.shootables());
    if (result && result.fighter && result.fighter.team !== bot.team) {
      const killed = applyDamage(result.fighter, result.damage, result.part, bot, hooks.onKill);
      hooks.onBotHit(bot, result.fighter, result.part, killed);
    }
    hooks.onBotShot(bot, tmpEye, tmpDir);
  }

  function stepBot(bot, dt, fighters) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = 0.15;
      const seen = nearestVisibleEnemy(bot, fighters);
      if (seen) {
        if (bot.target !== seen) {
          bot.target = seen;
          bot.seenAt = clock;
          bot.reactionAt = clock + REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
          bot.timeOnTarget = 0;
        }
        bot.lastSeen.copy(seen.position);
        bot.lastSeenTime = clock;
      } else if (bot.target && clock - bot.lastSeenTime > 1.2) {
        bot.target = null;
      }
    }
    if (bot.target) bot.timeOnTarget += dt;
    else bot.timeOnTarget = 0;
    bot.aimError = Math.max(0.012, 0.06 - bot.timeOnTarget * 0.02);

    // state decisions
    const bomb = hooks.bombState();
    if (bot.target) {
      bot.state = 'engage';
    } else if (bot.hasBomb) {
      bot.state = 'push';
    } else if (bomb.planted && bot.team === 'them') {
      bot.state = 'push';
    } else if (bot.hearPos && clock - bot.hearTime < 6) {
      bot.state = 'investigate';
    } else if (bot.patrolRoute) {
      bot.state = 'patrol';
    } else {
      bot.state = 'hold';
    }

    // movement + facing
    if (bot.state === 'engage' && bot.target) {
      const t = bot.target;
      tmpDir.set(t.position.x - bot.position.x, 0, t.position.z - bot.position.z);
      bot.yaw = Math.atan2(-tmpDir.x, -tmpDir.z);
      // strafe perpendicular, flip on a timer or on a wall
      if (clock > bot.strafeUntil) {
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        bot.strafeUntil = clock + 0.6 + Math.random() * 0.7;
      }
      const side = new THREE.Vector3(-tmpDir.z, 0, tmpDir.x).normalize().multiplyScalar(bot.strafeDir);
      const dist = tmpDir.length();
      let mx = side.x;
      let mz = side.z;
      if (dist > 22) { mx += tmpDir.x / dist; mz += tmpDir.z / dist; }
      if (dist < 7) { mx -= tmpDir.x / dist; mz -= tmpDir.z / dist; }
      const nx = bot.position.x + mx * BOT_SPEED * 0.55 * dt;
      if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
      const nz = bot.position.z + mz * BOT_SPEED * 0.55 * dt;
      if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
      // burst fire once the reaction time has passed
      if (clock >= bot.reactionAt) {
        if (bot.burstLeft <= 0 && bot.pauseTimer <= 0) {
          bot.burstLeft = 3 + Math.floor(Math.random() * 3);
          bot.pauseTimer = 0;
        }
        if (bot.burstLeft > 0) {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) {
            botShoot(bot, t);
            bot.burstLeft -= 1;
            bot.burstTimer = BOT_RIFLE.fireGap;
            if (bot.burstLeft === 0) bot.pauseTimer = 0.5 + Math.random() * 0.4;
          }
        } else {
          bot.pauseTimer -= dt;
        }
      }
    } else if (bot.state === 'push') {
      const dest = bomb.planted ? bomb.position : null;
      if (bot.hasBomb && !bomb.planted) {
        // carry the spike to the nearer site
        const targetSite = bot.position.x < 0 ? 'A' : 'B';
        const nodeId = targetSite === 'A' ? 'aSite' : 'bSite';
        if (!bot.path.length || bot.pathIndex >= bot.path.length) routeTo(bot, nodeId);
        if (followPath(bot, dt, BOT_SPEED) && !bot.planting) {
          bot.planting = true;
          hooks.onBotPlant(bot, targetSite);
        }
      } else if (dest) {
        // defenders converge on the planted spike
        if (!bot.path.length || bot.pathIndex >= bot.path.length) {
          const nodeId = bomb.site === 'A' ? 'aSite' : 'bSite';
          routeTo(bot, nodeId);
        }
        const d = bot.position.distanceTo(dest);
        if (d < 1.6) {
          bot.defuseProgress += dt / 5;
          hooks.onBotDefuse(bot, bot.defuseProgress);
          if (bot.defuseProgress >= 1) hooks.onDefused(bot);
        } else {
          bot.defuseProgress = 0;
          followPath(bot, dt, BOT_SPEED);
        }
      }
    } else if (bot.state === 'investigate' && bot.hearPos) {
      if (moveToward(bot, bot.hearPos.x, bot.hearPos.z, dt, BOT_SPEED)) {
        bot.hearPos = null;
      }
    } else if (bot.state === 'patrol' && bot.patrolRoute) {
      const nodeId = bot.patrolRoute[bot.patrolIndex % bot.patrolRoute.length];
      const [nx, nz] = nodes[nodeId];
      if (moveToward(bot, nx, nz, dt, BOT_SPEED * 0.8)) {
        bot.patrolIndex += 1;
      }
    }
    // hold: stand at the anchor, scan by slowly turning
    if (bot.state === 'hold') {
      bot.yaw += Math.sin(clock * 0.5 + bot.id.charCodeAt(0)) * dt * 0.25;
    }

    // stuck detection: no progress while following a path
    if (bot.path.length && bot.pathIndex < bot.path.length) {
      if (bot.position.distanceToSquared(bot.lastProgress) < 0.01) {
        bot.stuckTimer += dt;
        if (bot.stuckTimer > 1.2) {
          bot.path = [];
          bot.pathIndex = 0;
          bot.stuckTimer = 0;
        }
      } else {
        bot.stuckTimer = 0;
        bot.lastProgress.copy(bot.position);
      }
    }

    bot.group.position.copy(bot.position);
    bot.group.rotation.set(0, bot.yaw, 0);
  }

  function reset(spawns, assignments) {
    for (const bot of bots) {
      const spawn = spawns[bot.id];
      bot.position.copy(spawn);
      bot.group.position.copy(spawn);
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.velocity.set(0, 0, 0);
      bot.health = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.target = null;
      bot.path = [];
      bot.pathIndex = 0;
      bot.fall = 0;
      bot.hasBomb = false;
      bot.planting = false;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.hearPos = null;
      bot.state = 'hold';
      const assign = assignments[bot.id];
      bot.patrolRoute = assign && assign.patrol ? assign.patrol : null;
      bot.patrolIndex = 0;
      bot.anchorNode = assign && assign.anchor ? assign.anchor : bot.anchorNode;
      bot.yaw = bot.team === 'us' ? 0 : Math.PI;
    }
  }

  return {
    bots,
    step(dt, fighters) {
      clock += dt;
      for (const bot of bots) stepBot(bot, dt, fighters);
    },
    reset,
    hearShot(position, team) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === team || bot.target) continue;
        if (bot.position.distanceTo(position) <= HEAR_RANGE) {
          bot.hearPos = position.clone();
          bot.hearTime = clock;
        }
      }
    },
    giveBomb(bot) {
      bot.hasBomb = true;
    },
    allFighters() {
      return bots;
    },
  };
}
