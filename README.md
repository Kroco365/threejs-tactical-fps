# FOUNDRY PROTOCOL

A round-based tactical FPS in three.js — Counter-Strike-style, all original.
You are VANGUARD, attacking with two AI teammates against four EMBER
defenders on FOUNDRY-9, a dusk foundry with two bomb sites.

## How to play

Serve the game (no build step) and open it in desktop Chrome:

```
node serve.ts
# open http://localhost:8080
```

- **W A S D** move · **Shift** aim-walk · **Ctrl** crouch · **Space** jump
- **Mouse** look · **Click** fire · **R** reload · **Right-click** scope (sniper)
- **1–4** weapons · **G** throw grenade · **E** plant the spike (hold, inside a site)
- **B** buy menu during freeze time

## The match

- First to 5 rounds wins (max 9). A round lasts 100 seconds.
- Win a round by eliminating EMBER, or by planting the spike and letting it
  detonate. Lose it if the spike is defused or time runs out unplanted.
- Money: $800 to start, +$300 per kill, +$300 for a plant, +$3,250 for a
  round win, +$1,900 for a loss. Spend it in the buy menu: VANDAL-7 rifle
  ($2,700), STINGER-9 SMG ($1,500), LONGSHOT sniper ($4,750), HE grenade
  ($300), Kevlar ($650). Survive the round and you keep your primary.
- Headshots deal 4× damage. Firing on the move and spraying both punish
  accuracy — stop, crouch or aim-walk to land shots. Bots patrol lanes, hold
  sites, rotate to sounds and to the planted spike, and defuse it if you let
  them.

## Layout

```
game/            the game: index.html + src/ modules, three.js 0.187.0 vendored
screenshots/     3–4 real renders of the game
main.ts          the entry program: copies game/ + screenshots/ to /output
                 and writes /output/dossier.json
serve.ts         tiny static server for local play
vendor/          the kit's makefun-threejs.ts library, unchanged
```

## Modules

- `src/main.js` — boot, fixed 60 Hz loop, shooting, spike channels, buy flow
- `src/world.js` — the FOUNDRY-9 map, colliders, sites, waypoint graph
- `src/bots.js` — enemy and ally AI (hold / patrol / rotate / push / defuse / engage)
- `src/combat.js` — hitscan, armour, tracers, grenade explosions
- `src/weapons.js` — four weapons and the grenade
- `src/rounds.js` — round flow and economy
- `src/player.js` — movement and collision
- `src/hud.js` — the DOM HUD
- `src/audio.js` — synthesised WebAudio sounds (no audio files)
- `src/state.js` — the one match state
- `src/input.js` — keyboard, mouse, pointer lock
- `src/palette.js` — the look plan

## License

MIT — see LICENSE.
