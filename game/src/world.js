// FOUNDRY-9: the map. An original industrial foundry at dusk — two bomb sites
// (Furnace Hall west, Cooling Yard east), three lanes south to north, a connector
// across the middle. Every solid is a collider for movement and a surface a bullet
// stops on. Ground is flat (y = 0); cover is full-height or crouch-height boxes.
// Waypoints form the graph the bots route on; sites are rectangles the bomb
// recognises. All sizes are metres, x east, z south, attacker spawn at the south.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 4.6;

// Waypoint graph: id -> [x, z]; edges are listed both ways.
const NODES = {
  atkSpawn: [0, 16],
  aMain1: [-11, 10],
  aMain2: [-13, 2],
  aSite: [-16, -9],
  aBack: [-19, -14.5],
  bMain1: [11, 10],
  bMain2: [13, 2],
  bSite: [16, -9],
  bBack: [19, -14.5],
  mid1: [0, 10],
  mid2: [0, 2],
  mid3: [0, -6],
  connW: [-8, -4],
  connE: [8, -4],
  aDoor: [-15.5, -4],
  bDoor: [15.5, -4],
  defSpawn: [0, -16],
};

const EDGES = [
  ['atkSpawn', 'aMain1'], ['atkSpawn', 'mid1'], ['atkSpawn', 'bMain1'],
  ['aMain1', 'aMain2'], ['aMain2', 'connW'], ['aMain2', 'aSite'],
  ['aMain2', 'aDoor'], ['connW', 'aDoor'], ['aDoor', 'aSite'],
  ['mid1', 'mid2'], ['mid2', 'mid3'],
  ['mid3', 'defSpawn'], ['mid3', 'connW'], ['mid3', 'connE'],
  ['bMain1', 'bMain2'], ['bMain2', 'connE'], ['bMain2', 'bSite'],
  ['bMain2', 'bDoor'], ['connE', 'bDoor'], ['bDoor', 'bSite'],
  ['defSpawn', 'aBack'], ['defSpawn', 'bBack'],
  ['aBack', 'aSite'], ['bBack', 'bSite'],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'hazard' || name === 'ember' ? 0.5 : 0.92,
      metalness: name === 'cover' || name === 'wall' ? 0.25 : 0.04,
    });
  }
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.floor), roughness: 0.95, metalness: 0.05 });
  const glowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a0d06'), emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 2.2, roughness: 0.6 });
  const tealGlowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#06201c'), emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 1.6, roughness: 0.6 });

  const colliders = [];
  const shootables = [];
  const tmpBox = new THREE.Box3();

  function addCollider(mesh) {
    tmpBox.setFromObject(mesh);
    colliders.push(tmpBox.clone());
  }

  function box(w, h, d, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] || floorMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) addCollider(mesh);
    if (!opts.noShoot) shootables.push(mesh);
    return mesh;
  }

  function cylinder(rt, rb, h, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 18), materials[material] || floorMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) addCollider(mesh);
    if (!opts.noShoot) shootables.push(mesh);
    return mesh;
  }

  // ---- shell: floor, outer walls, open dusk sky above ----
  box(44.8, 0.4, 36.8, 0, -0.2, 0, 'floor');
  box(0.6, WALL_H, 36.8, -22.3, WALL_H / 2, 0, 'wall');
  box(0.6, WALL_H, 36.8, 22.3, WALL_H / 2, 0, 'wall');
  box(44.8, WALL_H, 0.6, 0, WALL_H / 2, -18.3, 'wall');
  box(44.8, WALL_H, 0.6, 0, WALL_H / 2, 18.3, 'wall');

  // ---- lane dividers: south half split into A-main / mid / B-main ----
  box(0.5, 3.4, 12, -7, 1.7, 10, 'wall');
  box(0.5, 3.4, 12, 7, 1.7, 10, 'wall');
  // mid divider stubs that leave the molten trench crossing open
  box(0.5, 3.4, 4, -7, 1.7, -1, 'wall');
  box(0.5, 3.4, 4, 7, 1.7, -1, 'wall');

  // ---- connector walls: the band z -6..-2 is the cross-map route ----
  box(6, 3.4, 0.5, -11, 1.7, -6.2, 'wall');
  box(6, 3.4, 0.5, 11, 1.7, -6.2, 'wall');
  box(4, 3.4, 0.5, -4, 1.7, -1.8, 'wall');
  box(4, 3.4, 0.5, 4, 1.7, -1.8, 'wall');

  // ---- site rooms: A west, B east, each with a main and a connector door ----
  box(0.5, 3.4, 8, -10.2, 1.7, -10, 'wall');
  box(0.5, 3.4, 8, 10.2, 1.7, -10, 'wall');
  // (no wall here: the site rooms stay open to the north pockets)

  // ---- the furnace (site A): big block, glowing mouth, chimney ----
  box(4.4, 3.6, 2.2, -19.5, 1.8, -9, 'rust');
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.2), glowMat);
  mouth.position.set(-17.2, 1.1, -9);
  group.add(mouth);
  shootables.push(mouth);
  cylinder(0.7, 0.9, 5.2, -20.5, 2.6, -11.5, 'cover');
  box(1.4, 0.5, 1.4, -19.5, 3.85, -9, 'cover');

  // ---- cooling towers (site B): two cylinders, teal rims ----
  cylinder(2.1, 2.5, 4.0, 18.5, 2.0, -11, 'cover');
  cylinder(1.7, 2.0, 3.2, 15.2, 1.6, -6.2, 'cover');
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 8, 28), tealGlowMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(18.5, 4.05, -11);
  group.add(rim);

  // ---- molten trench across mid (visual only, flat floor to cross) ----
  const trench = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 1.6), glowMat);
  trench.position.set(0, 0.03, 0);
  trench.receiveShadow = true;
  group.add(trench);
  box(2.2, 0.18, 2.4, 0, 0.09, 0, 'cover', { noCollide: true, noShoot: true }); // bridge slab

  // ---- cover: crates (crouch height), containers (full height), pillars ----
  const crates = [
    // A-main
    [-13.5, 0.55, 6.5, 1.2, 1.1, 1.2], [-15.5, 0.55, -2.5, 1.2, 1.1, 1.2],
    [-12.5, 0.55, -8.5, 2.4, 1.1, 1.2], [-18.5, 0.55, -5.5, 1.2, 1.1, 2.4],
    // B-main
    [13.5, 0.55, 6.5, 1.2, 1.1, 1.2], [15.5, 0.55, -2.5, 1.2, 1.1, 1.2],
    [12.5, 0.55, -8.5, 2.4, 1.1, 1.2], [18.5, 0.55, -5.5, 1.2, 1.1, 2.4],
    // mid
    [-3.6, 0.55, 4.5, 1.2, 1.1, 1.2], [3.6, 0.55, -3.5, 1.2, 1.1, 1.2],
    [-3.6, 0.55, -8.5, 1.2, 1.1, 1.2], [3.6, 0.55, 6.5, 1.2, 1.1, 1.2],
    // sites
    [-15, 0.55, -12.5, 1.2, 1.1, 1.2], [-13, 0.55, -11, 1.2, 1.1, 1.2],
    [15, 0.55, -12.5, 1.2, 1.1, 1.2], [13, 0.55, -11, 1.2, 1.1, 1.2],
    // spawns
    [-5, 0.55, 15.5, 1.2, 1.1, 1.2], [5, 0.55, 15.5, 1.2, 1.1, 1.2],
  ];
  for (const [x, y, z, w, h, d] of crates) box(w, h, d, x, y, z, 'cover');
  const containers = [
    [-8.6, 1.15, 12.5, 2.2, 2.3, 1.4, 'rust'], [8.6, 1.15, 12.5, 2.2, 2.3, 1.4, 'rust'],
    [-6.2, 1.15, -11.5, 1.4, 2.3, 2.2, 'rust'], [6.2, 1.15, -11.5, 1.4, 2.3, 2.2, 'rust'],
    [-19, 1.15, -1, 2.2, 2.3, 1.4, 'cover'], [19, 1.15, -1, 2.2, 2.3, 1.4, 'cover'],
  ];
  for (const [x, y, z, w, h, d, m] of containers) box(w, h, d, x, y, z, m);
  // pillars (kept off the connector line and the mid lane so bot routes stay clear)
  box(1.1, WALL_H, 1.1, -7, WALL_H / 2, -8, 'wall');
  box(1.1, WALL_H, 1.1, 7, WALL_H / 2, -8, 'wall');
  // hazard floor strips marking the sites
  box(7, 0.05, 0.5, -16, 0.03, -4.6, 'hazard', { noCollide: true, noShoot: true });
  box(7, 0.05, 0.5, 16, 0.03, -4.6, 'hazard', { noCollide: true, noShoot: true });
  // pipes along the north wall (rotated flat: cylinders stand vertical by default)
  const pipeW = cylinder(0.22, 0.22, 20, -11, 3.6, -17.9, 'rust', { noCollide: true, noShoot: true });
  pipeW.rotation.z = Math.PI / 2;
  const pipeE = cylinder(0.22, 0.22, 20, 11, 3.6, -17.9, 'rust', { noCollide: true, noShoot: true });
  pipeE.rotation.z = Math.PI / 2;

  // ---- light: dusk sky, cool moon key, furnace warmth, teal yard ----
  scene.add(new THREE.HemisphereLight(new THREE.Color('#33404f'), new THREE.Color('#191411'), 0.85));
  const key = new THREE.DirectionalLight(new THREE.Color('#cdd8ff'), 1.7);
  key.position.set(18, 30, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const furnaceLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 60, 20, 1.8);
  furnaceLight.position.set(-16.5, 2.2, -9);
  scene.add(furnaceLight);
  const yardLight = new THREE.PointLight(new THREE.Color(PALETTE.teal), 40, 18, 1.8);
  yardLight.position.set(16.5, 2.6, -9);
  scene.add(yardLight);
  const midLight = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 18, 12, 1.8);
  midLight.position.set(0, 1.6, 0);
  scene.add(midLight);

  // adjacency map for the waypoint graph
  const adjacency = {};
  for (const id of Object.keys(NODES)) adjacency[id] = [];
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    sites: {
      A: { minX: -21.5, maxX: -10.7, minZ: -17.5, maxZ: -4.6, center: new THREE.Vector3(-16, 0, -9) },
      B: { minX: 10.7, maxX: 21.5, minZ: -17.5, maxZ: -4.6, center: new THREE.Vector3(16, 0, -9) },
    },
    spawns: {
      player: new THREE.Vector3(0, 0, 16),
      allies: [new THREE.Vector3(-2.5, 0, 16.5), new THREE.Vector3(2.5, 0, 16.5)],
      enemies: [
        new THREE.Vector3(-4, 0, -15.5), new THREE.Vector3(-1.5, 0, -16),
        new THREE.Vector3(1.5, 0, -16), new THREE.Vector3(4, 0, -15.5),
      ],
    },
    waypoints: { nodes: NODES, adjacency },
  };
}
