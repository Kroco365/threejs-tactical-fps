// The arsenal: four hitscan weapons with different roles, and one HE grenade.
// Each weapon owns its numbers; main.js owns the ray, combat.js owns the damage.
// View models are plain boxes on the camera; the muzzle flash is a lit plane.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', kind: 'pistol', price: 0, auto: false,
    damage: 26, headMult: 4, magSize: 30, startReserve: Infinity, fireGap: 0.16,
    reloadTime: 1.1, spreadStill: 0.004, spreadMove: 0.02, bloomPerShot: 0.0016,
    range: 60, falloffAt: 25, kick: 0.006, barrel: 0.22, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'VANDAL-7', kind: 'rifle', price: 2700, auto: true,
    damage: 33, headMult: 4, magSize: 30, startReserve: 90, fireGap: 0.096,
    reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, bloomPerShot: 0.0026,
    range: 90, falloffAt: 30, kick: 0.009, barrel: 0.42, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'STINGER-9', kind: 'smg', price: 1500, auto: true,
    damage: 26, headMult: 4, magSize: 25, startReserve: 100, fireGap: 0.07,
    reloadTime: 1.6, spreadStill: 0.004, spreadMove: 0.032, bloomPerShot: 0.003,
    range: 55, falloffAt: 18, kick: 0.006, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'LONGSHOT', kind: 'sniper', price: 4750, auto: false,
    damage: 115, headMult: 4, magSize: 5, startReserve: 15, fireGap: 1.15,
    reloadTime: 2.8, spreadStill: 0.0008, spreadMove: 0.05, bloomPerShot: 0.012,
    range: 120, falloffAt: 40, kick: 0.03, barrel: 0.62, zoom: 0.35,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

const GRAVITY = 14;
const FUSE_AFTER_BOUNCE = 1.6;

export function createWeapons(camera, colliders) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.55, metalness: 0.2 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let modelParts = [];
  function buildModel(def) {
    for (const part of modelParts) model.remove(part);
    modelParts = [];
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.17 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.28);
    modelParts.push(receiver, barrel, stock);
    if (def.kind === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), accent);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      modelParts.push(scope);
    }
    if (def.kind === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), accent);
      mag.position.set(0, -0.12, -0.05);
      modelParts.push(mag);
    }
    for (const part of modelParts) model.add(part);
  }

  // per-weapon ammo persists across switches; grenades and armour are per round
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].startReserve };
  const state = {
    current: 'pistol',
    owned: new Set(['pistol']),
    cooldown: 0,
    reloadLeft: 0,
    bloom: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
    armor: 0,
    scoped: false,
  };
  buildModel(WEAPONS.pistol);

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.6 });
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.current];
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.current];
        const need = def.magSize - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    // grenades: gravity, bounce off colliders, fuse
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.velocity.y -= GRAVITY * dt;
      g.position.addScaledVector(g.velocity, dt);
      probe.min.set(g.position.x - 0.09, g.position.y - 0.09, g.position.z - 0.09);
      probe.max.set(g.position.x + 0.09, g.position.y + 0.09, g.position.z + 0.09);
      let hit = false;
      for (const c of colliders) if (probe.intersectsBox(c)) { hit = true; break; }
      if (g.position.y <= 0.09) hit = true;
      if (hit) {
        g.velocity.multiplyScalar(-0.42);
        g.velocity.y = Math.abs(g.velocity.y) * 0.5 + 0.5;
        if (g.position.y < 0.09) g.position.y = 0.09;
        if (!g.bounced) { g.bounced = true; g.fuse = Math.min(g.fuse, FUSE_AFTER_BOUNCE); }
      }
      g.fuse -= dt;
      g.mesh.position.copy(g.position);
      if (g.fuse <= 0) {
        g.mesh.removeFromParent();
        grenades.splice(i, 1);
        g.onExplode(g.position);
      }
    }
  }

  return {
    state,
    ammo,
    grenades,
    def() {
      return WEAPONS[state.current];
    },
    step,
    ready() {
      const slot = ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      const slot = ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    pullTrigger() {
      const def = WEAPONS[state.current];
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.03, state.bloom + def.bloomPerShot);
    },
    reload() {
      const def = WEAPONS[state.current];
      const slot = ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.magSize || slot.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed, moving) {
      const def = WEAPONS[state.current];
      const moveFactor = Math.min(1, speed / 5.2);
      const scoped = state.scoped && def.kind === 'sniper' ? 0.35 : 1;
      return (def.spreadStill + moveFactor * def.spreadMove + state.bloom) * (moving ? 1 : 0.55) * scoped;
    },
    switchTo(id) {
      if (!state.owned.has(id) || id === state.current) return false;
      state.current = id;
      state.reloadLeft = 0;
      state.scoped = false;
      buildModel(WEAPONS[id]);
      return true;
    },
    buy(id, money) {
      const def = WEAPONS[id];
      if (!def || state.owned.has(id) || money < def.price) return null;
      state.owned.add(id);
      ammo[id] = { mag: def.magSize, reserve: def.startReserve };
      return def.price;
    },
    buyGrenade(money) {
      if (state.grenades >= 1 || money < GRENADE_PRICE) return null;
      state.grenades = 1;
      return GRENADE_PRICE;
    },
    buyArmor(money) {
      if (state.armor > 0 || money < ARMOR_PRICE) return null;
      state.armor = 50;
      return ARMOR_PRICE;
    },
    throwGrenade(origin, direction, onExplode) {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      const position = origin.clone().addScaledVector(direction, 0.5);
      position.y -= 0.08;
      mesh.position.copy(position);
      camera.parent.add(mesh);
      const velocity = direction.clone().multiplyScalar(14);
      velocity.y += 4.5;
      grenades.push({ position, velocity, fuse: 2.4, bounced: false, mesh, onExplode });
      return true;
    },
    resetRound(keepPrimary) {
      const keep = keepPrimary && state.current !== 'pistol' ? state.current : 'pistol';
      state.owned = new Set(['pistol', ...(keep !== 'pistol' ? [keep] : [])]);
      for (const id of Object.keys(WEAPONS)) {
        ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].startReserve };
      }
      state.current = keep;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.bloom = 0;
      state.flash = 0;
      state.kick = 0;
      state.grenades = 0;
      state.armor = 0;
      state.scoped = false;
      buildModel(WEAPONS[keep]);
      for (const g of grenades) g.mesh.removeFromParent();
      grenades.length = 0;
    },
  };
}
