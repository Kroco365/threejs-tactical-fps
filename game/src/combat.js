// Shooting, damage and explosions, shared by the player and the bots. A fighter
// is any object with team, kind, alive, health, armor, position (feet), eye and
// hit meshes tagged with userData.part ('head' | 'torso') and userData.fighter.
// Hitscan is one ray against every shootable; the first hit decides. Armour
// absorbs half the damage until it is gone. Tracers are a fixed pool of lines.
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();

export function resolveHitscan(origin, direction, def, shootables) {
  raycaster.set(origin, direction);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootables, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const fighter = hit.object.userData.fighter || null;
  const part = hit.object.userData.part || null;
  let damage = 0;
  if (fighter) {
    damage = def.damage * (part === 'head' ? def.headMult : 1);
    if (hit.distance > def.falloffAt) {
      const t = Math.min(1, (hit.distance - def.falloffAt) / (def.range - def.falloffAt));
      damage *= 1 - t * 0.5;
    }
    damage = Math.round(damage);
  }
  return { fighter, part, damage, point: hit.point, distance: hit.distance, wall: !fighter };
}

export function applyDamage(fighter, amount, part, attacker, onKill) {
  if (!fighter.alive || amount <= 0) return false;
  let remaining = amount;
  if (fighter.armor > 0) {
    const absorbed = Math.min(fighter.armor, amount * 0.5);
    fighter.armor -= absorbed;
    remaining = amount - absorbed;
  }
  fighter.health -= remaining;
  if (fighter.onDamage) fighter.onDamage(remaining, attacker, part);
  if (fighter.health <= 0) {
    fighter.health = 0;
    fighter.alive = false;
    if (fighter.onDeath) fighter.onDeath(attacker);
    if (onKill) onKill(attacker, fighter, part);
    return true;
  }
  return false;
}

export function createTracers(scene) {
  const pool = [];
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    pool.push({ line, geo, mat, life: 0 });
  }
  let next = 0;
  return {
    spawn(from, to, color = 0xffd27a) {
      const slot = pool[next];
      next = (next + 1) % pool.length;
      const pos = slot.geo.attributes.position.array;
      pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
      pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
      slot.geo.attributes.position.needsUpdate = true;
      slot.mat.color.setHex(color);
      slot.mat.opacity = 0.85;
      slot.line.visible = true;
      slot.life = 0.07;
    },
    step(dt) {
      for (const slot of pool) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        if (slot.life <= 0) {
          slot.line.visible = false;
          slot.mat.opacity = 0;
        } else {
          slot.mat.opacity = (slot.life / 0.07) * 0.85;
        }
      }
    },
  };
}

export function explode(position, options) {
  const { radius, maxDamage, minDamage, fighters, world, onHit } = options;
  const hits = [];
  for (const fighter of fighters) {
    if (!fighter.alive) continue;
    tmp.set(fighter.position.x, fighter.position.y + 1.1, fighter.position.z);
    const dist = tmp.distanceTo(position);
    if (dist > radius) continue;
    let damage = maxDamage - ((maxDamage - minDamage) * dist) / radius;
    // walls halve the blast
    raycaster.set(position, tmp.clone().sub(position).normalize());
    raycaster.far = dist;
    const blocked = raycaster.intersectObjects(world.shootables, false);
    if (blocked.length) damage *= 0.4;
    damage = Math.round(damage);
    const killed = applyDamage(fighter, damage, 'torso', options.attacker || null, options.onKill);
    hits.push({ fighter, damage, killed });
    if (onHit) onHit(fighter, damage, killed);
  }
  return hits;
}
