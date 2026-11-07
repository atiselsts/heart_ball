# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sirsiņbumba (Heart Ball): a top-down, scrollable 2D browser game. Client-only JavaScript on a single canvas, with no dependencies, build step, tests or linter. `spec.md` holds the original brief. The Latvian name is preferred, and all in-game text is in Latvian, so new UI strings should be too.

## Running

Open `index.html` in a browser, or serve the directory:

```sh
python3 -m http.server 8000
```

Syntax check: `node --check game.js`

## Architecture

All game code is in `game.js`, a classic script (not a module) with global state, divided by `// ---------- Section ----------` comments. All art is drawn with canvas calls; there are no image or audio assets.

- **Loop and states:** `frame()` runs `update(dt)` only in `play`, but always calls `drawWorld()`, then overlays the HUD or a screen. `state` is `title | play | shop | over | win`; change it through `setState()`. The shop doubles as the pause screen, and `shopReturn` records where to go back to. Losing window focus during play opens it.
- **World vs. run state:** `buildWorld()` runs once with a fixed seed, so the garden layout (bushes, trees, paths, decor) is the same every game. `newGame()` rebuilds `game`, placing items and enemies with `Math.random`.
- **Navigation:** the 4000×4000 world maps onto a 25px grid. `blockedGrid` marks obstacles and `pathGrid` marks dirt paths, which also give a speed bonus (`PATH_SPEED`). Click-to-move uses A* (`findPath`) with path-aware costs, then `smoothRoute`. Changing obstacles or paths means the grids must be restamped, which `buildWorld()` does.
- **Trees:** `(x, y)` is the trunk base and `r` the trunk's collision radius. The canopy (radius `vr`) is drawn above it at `canopyY(tree)` and has no collision. It is drawn over the player and turns see-through when the player is under it. Use `underCover` rather than `insideObstacle` for spawn checks, so items aren't hidden under canopies.
- **Heart ball:** `p.hearts` is both ammo and armour. `orbitHearts()` computes the orbit positions; contact with an enemy or the boss spends a heart, and thrown hearts deal 2 damage against 1 for contact.
- **Persistence:** only `save` (diamonds, owned colours, selected colour) is kept, in `localStorage` under `SAVE_KEY`, and it is written on every change. Run progress is not saved. Changing the save's shape needs handling in `loadSave()` or a new key.

## Tuning

Bees and beetles still exist in the code but are switched off because they made the game too hard: `MAX_WILD_BEES`, `MAX_WILD_BEETLES` and `MAX_BOSS_BEES` are 0. Only stop-monsters (`stopper`) and the boss are active. Don't remove that code; raising the caps brings the enemies back.

## Known gaps

Touch input only covers moving and buying colours. Throwing hearts, opening or leaving the shop, and restarting after a win or loss all need a keyboard.

## Published artifact

The game is published at https://claude.ai/artifact/6BF9AW8ZAJmKT2JfoV1Ybx. The published page is a thin wrapper: the contents of `index.html` without the `<!doctype>`, `<html>`, `<head>` and `<body>` tags, which the publish step adds itself, with `game.js` sent as a supporting file. Local changes don't reach it until it is republished. To keep the link, publish to that `url`.
