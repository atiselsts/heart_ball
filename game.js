'use strict';

// Sirsiņbumba (Heart Ball) — a top-down garden game.

// ---------- Canvas ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1;

function resize() {
  DPR = window.devicePixelRatio || 1;
  VW = window.innerWidth;
  VH = window.innerHeight;
  canvas.width = Math.floor(VW * DPR);
  canvas.height = Math.floor(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------- Constants and helpers ----------
const TAU = Math.PI * 2;
const WORLD_W = 4000, WORLD_H = 4000;
const START = { x: 350, y: 3650 };
const ARENA = { x: 3450, y: 550, r: 480 };
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

// Dirt paths: control points, smoothed into curves in buildWorld().
const PATH_W = 64;
const PATH_SPEED = 1.45;   // movement multiplier on a path
const PATH_LINES = [
  [[START.x, START.y], [900, 3300], [1400, 3420], [2000, 2950], [2300, 2250], [2700, 1600], [3000, 1150], [3150, 860], [3380, 640]],
  [[900, 3300], [700, 2600], [620, 1850], [900, 1150], [1500, 650], [2300, 430], [2750, 720], [3000, 1150]],
  [[620, 1850], [1300, 2050], [2300, 2250]],
  [[2000, 2950], [2800, 3250], [3550, 3550]],
  [[2800, 3250], [3400, 2550], [3600, 1750], [3000, 1150]],
  [[1400, 3420], [1650, 3850]],
];

// Navigation grid used for pathfinding and for "am I on a path?" checks.
const CELL = 25;
const GW = WORLD_W / CELL, GH = WORLD_H / CELL;
const BLOCK_MARGIN = 20;
const blockedGrid = new Uint8Array(GW * GH);
const pathGrid = new Uint8Array(GW * GH);

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function angleDiff(a, b) {
  return ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

// Deterministic RNG so the garden layout is the same every game.
function seeded(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Colours (shop) and save data ----------
const COLORS = [
  { id: 'yellow', name: 'Dzeltena', price: 0, fill: '#ffd400' },
  { id: 'orange', name: 'Oranža', price: 15, fill: '#ff8c1a' },
  { id: 'red', name: 'Sarkana', price: 25, fill: '#ff3b3b' },
  { id: 'pink', name: 'Rozā', price: 35, fill: '#ff6fcf' },
  { id: 'blue', name: 'Zila', price: 50, fill: '#3b8bff' },
  { id: 'purple', name: 'Violeta', price: 70, fill: '#9b4dff' },
  { id: 'white', name: 'Balta', price: 90, fill: '#ffffff' },
  { id: 'rainbow', name: 'Varavīksne', price: 200, fill: null },
];

const SAVE_KEY = 'sirsinbumba-save-v1';
let save = { diamonds: 0, owned: ['yellow'], color: 'yellow' };

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.diamonds === 'number') {
      save.diamonds = s.diamonds;
      if (Array.isArray(s.owned)) save.owned = s.owned;
      if (typeof s.color === 'string') save.color = s.color;
    }
  } catch (e) { /* no storage available */ }
  if (!save.owned.includes('yellow')) save.owned.push('yellow');
  if (!COLORS.some(c => c.id === save.color)) save.color = 'yellow';
}

function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

function colorFill(id, t) {
  const c = COLORS.find(c => c.id === id);
  if (c && c.fill) return c.fill;
  return `hsl(${(t * 120) % 360}, 90%, 60%)`;
}

// ---------- World layout ----------
let bushes = [];
let trees = [];
let obstacles = [];   // bushes + trees: everything solid
let decor = [];
let paths = [];
let pebbles = [];

const BUSH_FLOWERS = {
  rose: ['#e8304f', '#ff7aa8', '#fff2f5', '#ffd23f', '#c2185b'],
  lily: ['#ffffff', '#ff9a3d', '#ffb3d1', '#fff0a0'],
  daisy: ['#ffffff', '#fff6d0'],
};

function makeBush(x, y, r, rng, flowering = rng() < 0.45) {
  const blobs = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    blobs.push({ dx: Math.cos(a) * r * 0.45, dy: Math.sin(a) * r * 0.45, r: r * (0.5 + rng() * 0.25) });
  }
  const berries = [], flowers = [];
  if (flowering) {
    const kinds = ['rose', 'rose', 'lily', 'daisy'];
    const nf = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < nf; i++) {
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const a = rng() * TAU, d = Math.sqrt(rng()) * r * 0.72;
      const palette = BUSH_FLOWERS[kind];
      flowers.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, kind, color: palette[Math.floor(rng() * palette.length)], s: 6 + rng() * 3, rot: rng() * TAU });
    }
  } else if (rng() < 0.35) {
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU, d = rng() * r * 0.7;
      berries.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d });
    }
  }
  return { kind: 'bush', x, y, r, blobs, berries, flowers, shade: rng() * 0.15 };
}

// (x, y) is the trunk base and r its collision radius; the canopy (radius vr)
// is drawn raised above the trunk, centred at canopyY(tree).
const canopyY = tr => tr.y - tr.vr * 0.5;

function makeTree(x, y, rng) {
  const conifer = rng() < 0.35;
  const vr = conifer ? 60 + rng() * 20 : 80 + rng() * 35;
  const blobs = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + rng() * 0.5;
    blobs.push({ dx: Math.cos(a) * vr * 0.5, dy: Math.sin(a) * vr * 0.5, r: vr * (0.45 + rng() * 0.15) });
  }
  const apples = [];
  if (!conifer && rng() < 0.3) {
    for (let i = 0; i < 7; i++) {
      const a = rng() * TAU, d = rng() * vr * 0.75;
      apples.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d });
    }
  }
  return { kind: 'tree', conifer, x, y, r: 16 + vr * 0.14, vr, blobs, apples, rot: rng() * TAU, shade: rng() * 0.12 };
}

// Catmull-Rom curve through the control points, sampled every ~10px.
function densify(ctrl) {
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.ceil(dist(p1[0], p1[1], p2[0], p2[1]) / 10);
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const last = ctrl[ctrl.length - 1];
  out.push({ x: last[0], y: last[1] });
  return out;
}

function nearPath(x, y, m) {
  for (const line of paths) {
    for (const pt of line) {
      if (Math.abs(pt.x - x) < m && Math.abs(pt.y - y) < m && dist(pt.x, pt.y, x, y) < m) return true;
    }
  }
  return false;
}

function stampDisc(grid, x, y, r) {
  const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.min(GW - 1, Math.floor((x + r) / CELL));
  const y0 = Math.max(0, Math.floor((y - r) / CELL)), y1 = Math.min(GH - 1, Math.floor((y + r) / CELL));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (dist((cx + 0.5) * CELL, (cy + 0.5) * CELL, x, y) <= r) grid[cy * GW + cx] = 1;
    }
  }
}

function buildWorld() {
  const rng = seeded(20261023);
  bushes = [];
  decor = [];
  paths = PATH_LINES.map(densify);
  pebbles = [];
  for (const line of paths) {
    for (let i = 1; i < line.length; i += 3) {
      if (rng() < 0.4) continue;
      const a = Math.atan2(line[i].y - line[i - 1].y, line[i].x - line[i - 1].x) + Math.PI / 2;
      const off = (rng() - 0.5) * (PATH_W - 14);
      pebbles.push({ x: line[i].x + Math.cos(a) * off, y: line[i].y + Math.sin(a) * off, r: 1.5 + rng() * 2.5, rot: rng() * TAU });
    }
  }

  // Hedge ring around the boss arena with an opening towards the start.
  const gap = Math.atan2(START.y - ARENA.y, START.x - ARENA.x);
  for (let a = 0; a < TAU; a += 0.13) {
    if (Math.abs(angleDiff(a, gap)) < 0.32) continue;
    bushes.push(makeBush(ARENA.x + Math.cos(a) * ARENA.r, ARENA.y + Math.sin(a) * ARENA.r, 38 + rng() * 10, rng, rng() < 0.25));
  }

  // Bush clusters scattered around the garden.
  let tries = 0, clusters = 0;
  while (clusters < 75 && tries < 2000) {
    tries++;
    const x = 120 + rng() * (WORLD_W - 240), y = 120 + rng() * (WORLD_H - 240);
    if (dist(x, y, START.x, START.y) < 350) continue;
    if (dist(x, y, ARENA.x, ARENA.y) < ARENA.r + 180) continue;
    if (bushes.some(b => dist(x, y, b.x, b.y) < b.r + 160)) continue;
    if (nearPath(x, y, PATH_W / 2 + 60)) continue;
    const n = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const bx = x + (rng() - 0.5) * 120, by = y + (rng() - 0.5) * 120, br = 30 + rng() * 30;
      if (nearPath(bx, by, PATH_W / 2 + br + BLOCK_MARGIN + 6)) continue;
      bushes.push(makeBush(bx, by, br, rng));
    }
    clusters++;
  }

  // Trees, alone or in small groves. Canopies may overhang paths, trunks may not.
  trees = [];
  tries = 0;
  let groves = 0;
  while (groves < 45 && tries < 3000) {
    tries++;
    const x = 150 + rng() * (WORLD_W - 300), y = 150 + rng() * (WORLD_H - 300);
    if (dist(x, y, START.x, START.y) < 400) continue;
    const n = 1 + Math.floor(rng() * 3);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const t = makeTree(x + (rng() - 0.5) * 220, y + (rng() - 0.5) * 220, rng);
      const cy = canopyY(t);
      if (t.x < t.vr * 0.6 || cy < t.vr * 0.6 || t.x > WORLD_W - t.vr * 0.6 || t.y > WORLD_H - 40) continue;
      if (dist(t.x, cy, ARENA.x, ARENA.y) < ARENA.r + t.vr + 30) continue;
      if (nearPath(t.x, t.y, PATH_W / 2 + t.r + BLOCK_MARGIN + 6)) continue;
      if (bushes.some(b => dist(t.x, cy, b.x, b.y) < b.r + t.vr * 0.8)) continue;
      if (trees.some(o => dist(t.x, cy, o.x, canopyY(o)) < (o.vr + t.vr) * 0.75)) continue;
      trees.push(t);
      placed++;
    }
    if (placed) groves++;
  }
  obstacles = bushes.concat(trees);

  pathGrid.fill(0);
  blockedGrid.fill(0);
  for (const line of paths) for (const pt of line) stampDisc(pathGrid, pt.x, pt.y, PATH_W / 2);
  for (const o of obstacles) stampDisc(blockedGrid, o.x, o.y, o.r + BLOCK_MARGIN);

  const flowerColors = ['#ff6fa8', '#ffffff', '#ffe14d', '#b07cff', '#ff8a3d', '#6fc3ff', '#ff4d4d'];
  for (let i = 0; i < 2600; i++) {
    const x = rng() * WORLD_W, y = rng() * WORLD_H;
    const inArena = dist(x, y, ARENA.x, ARENA.y) < ARENA.r - 40;
    const roll = rng();
    if (isOnPath(x, y)) continue;
    if (roll < 0.45) {
      decor.push({ type: 'tuft', x, y, s: 6 + rng() * 6, rot: (rng() - 0.5) * 0.6 });
    } else if (roll < 0.88) {
      if (inArena && rng() < 0.7) continue;
      decor.push({ type: 'flower', x, y, s: 4 + rng() * 5, color: flowerColors[Math.floor(rng() * flowerColors.length)], rot: rng() * TAU, petals: 5 + Math.floor(rng() * 3) });
    } else if (roll < 0.97) {
      if (inArena) continue;
      decor.push({ type: 'plant', x, y, s: 14 + rng() * 14, rot: (rng() - 0.5) * 0.5 });
    } else {
      if (inArena) continue;
      decor.push({ type: 'tulip', x, y, s: 10 + rng() * 6, color: flowerColors[Math.floor(rng() * flowerColors.length)] });
    }
  }
}

function insideObstacle(x, y, r) {
  return obstacles.some(o => dist(x, y, o.x, o.y) < o.r + r + 4);
}

// Like insideObstacle, but counts the whole tree canopy so items aren't hidden under it.
function underCover(x, y, r) {
  return obstacles.some(o => o.kind === 'tree'
    ? dist(x, y, o.x, canopyY(o)) < o.vr + r + 4 || dist(x, y, o.x, o.y) < o.r + r + 4
    : dist(x, y, o.x, o.y) < o.r + r + 4);
}

// Find a free spot. opts: minDist from point `away`, allowArena, offscreen.
function freePos(r, opts = {}) {
  for (let i = 0; i < 300; i++) {
    const x = rand(80, WORLD_W - 80), y = rand(80, WORLD_H - 80);
    if (opts.away && dist(x, y, opts.away.x, opts.away.y) < opts.minDist) continue;
    if (!opts.allowArena && dist(x, y, ARENA.x, ARENA.y) < ARENA.r + 70) continue;
    if (opts.offscreen && Math.abs(x - game.player.x) < VW / 2 + 80 && Math.abs(y - game.player.y) < VH / 2 + 80) continue;
    if (underCover(x, y, r)) continue;
    return { x, y };
  }
  return null;
}

function pushOutOfObstacles(o) {
  for (const b of obstacles) {
    const dx = o.x - b.x, dy = o.y - b.y;
    const min = b.r + o.r * 0.8;
    const d2 = dx * dx + dy * dy;
    if (d2 < min * min) {
      const d = Math.sqrt(d2) || 0.01;
      o.x = b.x + dx / d * min;
      o.y = b.y + dy / d * min;
    }
  }
}

// ---------- Pathfinding ----------
function cellOf(x, y) {
  return clamp(Math.floor(y / CELL), 0, GH - 1) * GW + clamp(Math.floor(x / CELL), 0, GW - 1);
}
const cellX = i => (i % GW + 0.5) * CELL;
const cellY = i => (Math.floor(i / GW) + 0.5) * CELL;
const cellCost = i => pathGrid[i] ? 1 / PATH_SPEED : 1;

function isOnPath(x, y) {
  return pathGrid[cellOf(x, y)] === 1;
}

class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.vals.length; }
  push(val, key) {
    const k = this.keys, v = this.vals;
    let i = v.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k[parent] <= key) break;
      k[i] = k[parent]; v[i] = v[parent];
      i = parent;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lastK = k.pop(), lastV = v.pop();
    if (v.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= v.length) break;
        if (c + 1 < v.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}

function nearestFree(i0) {
  const seen = new Set([i0]);
  const queue = [i0];
  for (let h = 0; h < queue.length && h < 6000; h++) {
    const i = queue[h];
    if (!blockedGrid[i]) return i;
    const x = i % GW, y = Math.floor(i / GW);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (!seen.has(ni)) { seen.add(ni); queue.push(ni); }
    }
  }
  return -1;
}

// Cost (in cell units) of walking a straight line; Infinity if it crosses a bush.
function lineCost(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by);
  const n = Math.max(1, Math.ceil(d / (CELL / 3)));
  let c = 0;
  for (let s = 0; s < n; s++) {
    const t = (s + 0.5) / n;
    const i = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (blockedGrid[i]) return Infinity;
    c += cellCost(i);
  }
  return c * d / n / CELL;
}

// Skip grid waypoints where a straight line is no more expensive,
// so routes look natural but still hug the paths when that's faster.
function smoothRoute(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + lineCost(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  }
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    for (let j = i + 2; j < pts.length && j <= i + 60; j++) {
      const lc = lineCost(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
      if (lc !== Infinity && lc <= cum[j] - cum[i] + 0.05) best = j;
    }
    out.push(pts[best]);
    i = best;
  }
  return out;
}

const NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// A* over the grid. Returns waypoints (excluding the start) or null.
function findPath(sx, sy, tx, ty) {
  let start = cellOf(sx, sy), goal = cellOf(tx, ty);
  const startFree = !blockedGrid[start], goalFree = !blockedGrid[goal];
  if (!startFree) start = nearestFree(start);
  if (!goalFree) goal = nearestFree(goal);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [goalFree ? { x: tx, y: ty } : { x: cellX(goal), y: cellY(goal) }];

  const N = GW * GH;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const minCost = 1 / PATH_SPEED;
  const gx = goal % GW, gy = Math.floor(goal / GW);
  const h = i => {
    const dx = Math.abs(i % GW - gx), dy = Math.abs(Math.floor(i / GW) - gy);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * minCost;
  };
  g[start] = 0;
  heap.push(start, h(start));
  let closest = start, closestH = h(start);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const hc = h(cur);
    if (hc < closestH) { closest = cur; closestH = hc; }
    const cx = cur % GW, cy = Math.floor(cur / GW);
    for (const [dx, dy, len] of NEIGHBORS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (blockedGrid[ni] || closed[ni]) continue;
      if (dx && dy && (blockedGrid[cy * GW + nx] || blockedGrid[ny * GW + cx])) continue;
      const ng = g[cur] + len * (cellCost(cur) + cellCost(ni)) / 2;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        heap.push(ni, ng + h(ni));
      }
    }
  }
  let reachable = goalFree;
  if (from[goal] < 0) {
    // Goal is walled off: walk as close as we can get instead.
    if (closest === start) return null;
    goal = closest;
    reachable = false;
  }

  const cells = [];
  for (let i = goal; i !== start; i = from[i]) cells.push(i);
  cells.push(start);
  cells.reverse();
  const pts = cells.map(i => ({ x: cellX(i), y: cellY(i) }));
  if (startFree) pts[0] = { x: sx, y: sy };
  if (reachable) pts[pts.length - 1] = { x: tx, y: ty };
  const route = smoothRoute(pts);
  if (startFree) route.shift();
  return route;
}

// ---------- Game state ----------
let state = 'title';      // title | play | shop | over | win
let shopReturn = 'title';
let shopSel = 0;
let shopMsg = null;
let shopCards = [];
let stateT = 0;           // time since entering the current state
let game = null;
const keys = {};

const BOOST_NAMES = { speed: 'Ātrums', star: 'Zvaigzne', magnet: 'Magnēts' };
const BOOST_TIMES = { speed: 6, star: 5, magnet: 8 };
// Bees and beetles are switched off (too hard); raise these caps to bring them back.
const MAX_WILD_BEES = 0, MAX_WILD_BEETLES = 0, MAX_STOPPERS = 7, MAX_BOSS_BEES = 0;

function newGame() {
  game = {
    t: 0,
    shake: 0,
    respawnT: 0,
    enemyRespawnT: 0,
    endT: -1,
    player: {
      x: START.x, y: START.y, r: 18, dir: -Math.PI / 4, moving: false,
      hp: 5, maxHp: 5, inv: 0, hearts: 3, throwCd: 0, mouthT: 0,
      kx: 0, ky: 0, grow: 0,
      route: null, routeBest: Infinity, routeStuck: 0, routeRetries: 0,
      boosts: { speed: 0, star: 0, magnet: 0 },
    },
    enemies: [],
    items: [],
    shots: [],
    foeShots: [],
    particles: [],
    texts: [],
    boss: {
      cx: ARENA.x, cy: ARENA.y, x: ARENA.x, y: ARENA.y, r: 58,
      hp: 80, maxHp: 80, t: 0, active: false, dead: false, deadT: 0,
      burstT: 2.5, aimT: 2, spawnT: 5, hitCd: 0, flash: 0, phase: 1,
    },
  };
  const away = { away: START, minDist: 250 };
  for (let i = 0; i < 150; i++) spawnItem('diamond', away);
  for (let i = 0; i < 110; i++) spawnItem('heart', away);
  for (let i = 0; i < 22; i++) spawnItem('bowtie', away);
  // A few hearts close to the start so the player can try them right away.
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    game.items.push(makeItem('heart', START.x + 260 + Math.cos(a) * 80, START.y - 200 + Math.sin(a) * 80));
  }
  const enemyOpts = { away: START, minDist: 700 };
  for (let i = 0; i < MAX_WILD_BEES; i++) spawnEnemy('bee', enemyOpts);
  for (let i = 0; i < MAX_WILD_BEETLES; i++) spawnEnemy('beetle', enemyOpts);
  for (let i = 0; i < MAX_STOPPERS; i++) spawnStopper();
}

function makeItem(type, x, y) {
  const bowColors = ['#e23b6a', '#7b4dff', '#1fa3ff', '#ff8a1f'];
  return { type, x, y, phase: Math.random() * TAU, color: pick(bowColors), vx: 0, vy: 0 };
}

function spawnItem(type, opts) {
  const p = freePos(14, opts);
  if (p) game.items.push(makeItem(type, p.x, p.y));
}

function makeEnemy(type, x, y) {
  if (type === 'bee') {
    return { type, x, y, r: 12, hp: 1, speed: 135, aggro: 420, t: Math.random() * 10, wa: rand(0, TAU), kx: 0, ky: 0, hitCd: 0, flash: 0, fromBoss: false };
  }
  if (type === 'stopper') {
    return {
      type, x, y, r: 22, hp: 4, speed: 0, aggro: 190, t: Math.random() * 10, wa: rand(0, TAU), kx: 0, ky: 0, hitCd: 0, flash: 0, fromBoss: false,
      homeX: x, homeY: y, hopT: Math.random() * 2, hopH: 0, sayT: 0, sayCd: 0, face: 1,
    };
  }
  return { type, x, y, r: 19, hp: 3, speed: 65, aggro: 300, t: Math.random() * 10, wa: rand(0, TAU), kx: 0, ky: 0, hitCd: 0, flash: 0, fromBoss: false };
}

// Stop-monsters guard the paths: they hop around home, and when the player
// comes close they shout "STOP!" and hop into the way.
function spawnStopper(opts = {}) {
  for (let i = 0; i < 100; i++) {
    const pt = pick(pick(paths));
    const x = pt.x + rand(-20, 20), y = pt.y + rand(-20, 20);
    if (dist(x, y, START.x, START.y) < 600 || dist(x, y, ARENA.x, ARENA.y) < ARENA.r + 100) continue;
    if (opts.offscreen && Math.abs(x - game.player.x) < VW / 2 + 80 && Math.abs(y - game.player.y) < VH / 2 + 80) continue;
    if (game.enemies.some(e => e.type === 'stopper' && dist(e.x, e.y, x, y) < 500)) continue;
    game.enemies.push(makeEnemy('stopper', x, y));
    return;
  }
}

function stopperMove(e, d, alive, dt) {
  const p = game.player;
  e.sayT = Math.max(0, e.sayT - dt);
  e.sayCd = Math.max(0, e.sayCd - dt);
  const alert = alive && d < e.aggro;
  if (alert && e.sayCd <= 0) {
    e.sayT = 1.6;
    e.sayCd = 3;
  }
  const period = alert ? 0.7 : 1.4;
  const prevPhase = e.hopT % period;
  e.hopT += dt;
  const phase = e.hopT % period;
  if (phase < prevPhase && !alert) {
    // Landed: pick a new idle direction, drifting back home when too far.
    e.wa = dist(e.x, e.y, e.homeX, e.homeY) > 200 ? Math.atan2(e.homeY - e.y, e.homeX - e.x) : e.wa + rand(-1.2, 1.2);
  }
  const airborne = phase < 0.35;
  e.hopH = airborne ? Math.sin(phase / 0.35 * Math.PI) * 14 : 0;
  const a = alert ? Math.atan2(p.y - e.y, p.x - e.x) : e.wa;
  if (Math.abs(Math.cos(a)) > 0.2) e.face = Math.cos(a) < 0 ? -1 : 1;
  return [a, airborne ? (alert ? 150 : 60) : 0];
}

function spawnEnemy(type, opts) {
  const p = freePos(20, opts);
  if (p) game.enemies.push(makeEnemy(type, p.x, p.y));
}

function maxHearts(p) {
  return 10 + Math.floor((p.r - 18) / 2);
}

function addText(x, y, text, color = '#fff') {
  game.texts.push({ x, y, text, color, life: 1.2 });
}

function burst(x, y, color, n, speed = 160, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(speed * 0.3, speed);
    const life = rand(0.4, 0.8);
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(size * 0.6, size * 1.4) });
  }
}

// ---------- Player actions ----------
function damagePlayer(fromX, fromY) {
  const p = game.player;
  if (p.inv > 0 || p.boosts.star > 0 || game.endT >= 0) return;
  p.hp -= 1;
  p.inv = 1.2;
  game.shake = 10;
  const a = Math.atan2(p.y - fromY, p.x - fromX);
  p.kx = Math.cos(a) * 420;
  p.ky = Math.sin(a) * 420;
  burst(p.x, p.y, '#ff4d6d', 14, 200);
  if (p.hp <= 0) {
    p.hp = 0;
    game.endT = 0;
    burst(p.x, p.y, colorFill(save.color, game.t), 40, 300, 5);
  }
}

function setMoveTarget(x, y) {
  const p = game.player;
  const route = findPath(p.x, p.y, clamp(x, p.r, WORLD_W - p.r), clamp(y, p.r, WORLD_H - p.r));
  p.route = route && route.length ? route : null;
  p.routeBest = Infinity;
  p.routeStuck = 0;
  p.routeRetries = 0;
}

// Returns a unit direction towards the next waypoint, or null when done.
function followRoute(p, step, dt) {
  while (p.route.length && dist(p.x, p.y, p.route[0].x, p.route[0].y) <= Math.max(6, step)) {
    p.route.shift();
    p.routeBest = Infinity;
    p.routeStuck = 0;
  }
  if (!p.route.length) {
    p.route = null;
    return null;
  }
  const wp = p.route[0];
  const d = dist(p.x, p.y, wp.x, wp.y);
  if (d < p.routeBest - 0.5) {
    p.routeBest = d;
    p.routeStuck = 0;
  } else if ((p.routeStuck += dt) > 0.6) {
    // Knocked off course or wedged against a bush: plan again from here.
    const goal = p.route[p.route.length - 1];
    const retries = p.routeRetries + 1;
    setMoveTarget(goal.x, goal.y);
    p.routeRetries = retries;
    if (retries > 3) p.route = null;
    return null;
  }
  return { x: (wp.x - p.x) / d, y: (wp.y - p.y) / d };
}

function throwHeart() {
  const p = game.player;
  if (p.hearts <= 0 || p.throwCd > 0) return;
  p.hearts--;
  p.throwCd = 0.22;
  const sp = 560;
  game.shots.push({
    x: p.x + Math.cos(p.dir) * (p.r + 6), y: p.y + Math.sin(p.dir) * (p.r + 6),
    vx: Math.cos(p.dir) * sp, vy: Math.sin(p.dir) * sp, life: 1.1, rot: 0,
  });
}

function eatBowtie(item) {
  const p = game.player;
  if (p.r < 42) {
    p.r = Math.min(42, p.r + 2);
    p.grow = 0.4;
    addText(p.x, p.y - p.r - 18, 'Lielāks!', '#fff7a8');
  }
  p.maxHp = 5 + Math.floor((p.r - 18) / 6);
  p.hp = Math.min(p.maxHp, p.hp + 1);
  if (Math.random() < 0.6) {
    const b = pick(['speed', 'star', 'magnet']);
    p.boosts[b] = BOOST_TIMES[b];
    addText(p.x, p.y - p.r - 38, BOOST_NAMES[b] + '!', '#9ff7ff');
  }
  burst(item.x, item.y, item.color, 16, 180);
}

function orbitHearts(p, t) {
  const n = p.hearts, res = [];
  if (n <= 0) return res;
  const R = p.r + 20 + Math.min(n, 22) * 0.7;
  for (let i = 0; i < n; i++) {
    const a = t * 2.4 + i * TAU / n;
    res.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R });
  }
  return res;
}

function killEnemy(e) {
  e.dead = true;
  burst(e.x, e.y, { bee: '#ffd23f', beetle: '#c0392b', stopper: '#6fae4a' }[e.type], 16, 200);
  if (e.fromBoss) {
    if (Math.random() < 0.5) game.items.push(makeItem('heart', e.x, e.y));
    return;
  }
  if (e.type === 'stopper') {
    for (let i = 0; i < 3; i++) game.items.push(makeItem('diamond', e.x + (i - 1) * 16, e.y));
  } else if (e.type === 'beetle') {
    game.items.push(makeItem('diamond', e.x - 10, e.y));
    game.items.push(makeItem('diamond', e.x + 10, e.y));
    if (Math.random() < 0.12) game.items.push(makeItem('bowtie', e.x, e.y + 12));
  } else if (Math.random() < 0.5) {
    game.items.push(makeItem('diamond', e.x, e.y));
  }
  if (Math.random() < 0.35) game.items.push(makeItem('heart', e.x, e.y - 14));
}

function hitEnemy(e, dmg, fromX, fromY) {
  e.hp -= dmg;
  e.flash = 0.15;
  const a = Math.atan2(e.y - fromY, e.x - fromX);
  e.kx = Math.cos(a) * 320;
  e.ky = Math.sin(a) * 320;
  burst(e.x, e.y, '#ff6f91', 6, 120);
  if (e.hp <= 0) killEnemy(e);
}

function hitBoss(dmg) {
  const b = game.boss;
  if (b.dead) return;
  b.hp -= dmg;
  b.flash = 0.12;
  burst(b.x, b.y, '#ff9ccf', 8, 180);
  if (b.hp <= 0) {
    b.hp = 0;
    b.dead = true;
    b.deadT = 0;
    game.shake = 18;
    burst(b.x, b.y, '#ff69b4', 70, 380, 6);
    burst(b.x, b.y, '#ffcc33', 40, 300, 5);
    for (const e of game.enemies) if (e.fromBoss) killEnemy(e);
    game.foeShots = [];
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), d = rand(30, 200);
      game.items.push(makeItem('diamond', b.x + Math.cos(a) * d, b.y + Math.sin(a) * d));
    }
    addText(b.x, b.y - 90, 'Puķu boss ir uzvarēts!', '#fff7a8');
  }
}

// ---------- Update ----------
function update(dt) {
  game.t += dt;
  game.shake = Math.max(0, game.shake - dt * 40);
  const p = game.player;
  const alive = game.endT < 0;

  // Movement: arrow keys, or follow a clicked route.
  const speed = 230 * (p.boosts.speed > 0 ? 1.6 : 1) * (1 - (p.r - 18) * 0.006) * (isOnPath(p.x, p.y) ? PATH_SPEED : 1);
  let ix = 0, iy = 0;
  if (alive) {
    if (keys.ArrowLeft) ix -= 1;
    if (keys.ArrowRight) ix += 1;
    if (keys.ArrowUp) iy -= 1;
    if (keys.ArrowDown) iy += 1;
    if (ix || iy) {
      p.route = null;
    } else if (pointer.held) {
      pointer.retargetT -= dt;
      if (pointer.retargetT <= 0) {
        pointer.retargetT = 0.15;
        setMoveTarget(pointer.x + cam.x, pointer.y + cam.y);
      }
    }
    if (!ix && !iy && p.route) {
      const step = followRoute(p, speed * dt, dt);
      if (step) { ix = step.x; iy = step.y; }
    }
  }
  p.moving = ix !== 0 || iy !== 0;
  if (p.moving) {
    const l = Math.hypot(ix, iy);
    ix /= l; iy /= l;
    p.dir = Math.atan2(iy, ix);
  }
  p.x += (ix * speed + p.kx) * dt;
  p.y += (iy * speed + p.ky) * dt;
  const kd = Math.pow(0.004, dt);
  p.kx *= kd; p.ky *= kd;
  p.x = clamp(p.x, p.r, WORLD_W - p.r);
  p.y = clamp(p.y, p.r, WORLD_H - p.r);
  pushOutOfObstacles(p);
  p.mouthT += dt * (p.moving ? 12 : 3);
  p.inv = Math.max(0, p.inv - dt);
  p.throwCd = Math.max(0, p.throwCd - dt);
  p.grow = Math.max(0, p.grow - dt);
  for (const k in p.boosts) p.boosts[k] = Math.max(0, p.boosts[k] - dt);
  if (alive && keys.Space) throwHeart();

  // Items
  const magnet = p.boosts.magnet > 0;
  for (const it of game.items) {
    it.phase += dt * 3;
    const d = dist(it.x, it.y, p.x, p.y);
    if (magnet && d < 280 && (it.type !== 'heart' || p.hearts < maxHearts(p))) {
      const a = Math.atan2(p.y - it.y, p.x - it.x);
      it.x += Math.cos(a) * 380 * dt;
      it.y += Math.sin(a) * 380 * dt;
    }
    if (!alive || d > p.r + 14) continue;
    if (it.type === 'diamond') {
      save.diamonds++;
      writeSave();
      it.dead = true;
      burst(it.x, it.y, '#7ff3ff', 8, 120);
    } else if (it.type === 'heart') {
      if (p.hearts < maxHearts(p)) {
        p.hearts++;
        it.dead = true;
        burst(it.x, it.y, '#ff6f91', 8, 120);
      }
    } else if (it.type === 'bowtie') {
      it.dead = true;
      eatBowtie(it);
    }
  }
  game.items = game.items.filter(it => !it.dead);

  // Enemies
  const orb = orbitHearts(p, game.t);
  for (const e of game.enemies) {
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.hitCd = Math.max(0, e.hitCd - dt);
    const d = dist(e.x, e.y, p.x, p.y);
    let a, spd = e.speed;
    if (e.type === 'stopper') {
      [a, spd] = stopperMove(e, d, alive, dt);
    } else if (alive && (d < e.aggro || e.fromBoss)) {
      a = Math.atan2(p.y - e.y, p.x - e.x);
      if (e.type === 'bee') a += Math.sin(e.t * 5) * 0.5;
    } else {
      e.wa += rand(-1, 1) * dt * 3;
      a = e.wa;
    }
    e.x += (Math.cos(a) * spd + e.kx) * dt;
    e.y += (Math.sin(a) * spd + e.ky) * dt;
    const ekd = Math.pow(0.01, dt);
    e.kx *= ekd; e.ky *= ekd;
    if (e.x < e.r || e.x > WORLD_W - e.r) e.wa = Math.PI - e.wa;
    if (e.y < e.r || e.y > WORLD_H - e.r) e.wa = -e.wa;
    e.x = clamp(e.x, e.r, WORLD_W - e.r);
    e.y = clamp(e.y, e.r, WORLD_H - e.r);
    if (e.type !== 'bee') pushOutOfObstacles(e);
    // Wild critters stay out of the boss arena.
    if (!e.fromBoss) {
      const da = dist(e.x, e.y, ARENA.x, ARENA.y);
      if (da < ARENA.r + 40) {
        const aa = Math.atan2(e.y - ARENA.y, e.x - ARENA.x);
        e.x = ARENA.x + Math.cos(aa) * (ARENA.r + 40);
        e.y = ARENA.y + Math.sin(aa) * (ARENA.r + 40);
        e.wa = aa;
      }
    }

    // Heart ball contact
    if (e.hitCd <= 0 && p.hearts > 0) {
      for (const h of orb) {
        if (dist(h.x, h.y, e.x, e.y) < e.r + 9) {
          p.hearts--;
          e.hitCd = 0.35;
          hitEnemy(e, 1, p.x, p.y);
          break;
        }
      }
    }
    if (!e.dead && alive && dist(e.x, e.y, p.x, p.y) < e.r + p.r * 0.85) {
      if (e.type === 'stopper') {
        // Stop-monsters are solid: they block the way as well as hurt.
        const aa = Math.atan2(p.y - e.y, p.x - e.x);
        p.x = e.x + Math.cos(aa) * (e.r + p.r * 0.85);
        p.y = e.y + Math.sin(aa) * (e.r + p.r * 0.85);
      }
      damagePlayer(e.x, e.y);
    }
  }

  // Thrown hearts
  for (const s of game.shots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    s.rot += dt * 10;
    if (s.life <= 0 || insideObstacle(s.x, s.y, -6) || s.x < 0 || s.y < 0 || s.x > WORLD_W || s.y > WORLD_H) {
      s.dead = true;
      burst(s.x, s.y, '#ff6f91', 6, 90);
      continue;
    }
    for (const e of game.enemies) {
      if (!e.dead && dist(s.x, s.y, e.x, e.y) < e.r + 9) {
        hitEnemy(e, 2, s.x - s.vx, s.y - s.vy);
        s.dead = true;
        break;
      }
    }
    const b = game.boss;
    if (!s.dead && !b.dead && dist(s.x, s.y, b.x, b.y) < b.r * 1.2) {
      hitBoss(2);
      s.dead = true;
    }
  }
  game.shots = game.shots.filter(s => !s.dead);
  game.enemies = game.enemies.filter(e => !e.dead);

  updateBoss(dt, orb, alive);

  // Enemy projectiles
  for (const f of game.foeShots) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.life -= dt;
    if (f.life <= 0) { f.dead = true; continue; }
    for (const h of orb) {
      if (dist(h.x, h.y, f.x, f.y) < 14) {
        f.dead = true;
        burst(f.x, f.y, '#ffb3d9', 5, 80);
        break;
      }
    }
    if (!f.dead && alive && dist(f.x, f.y, p.x, p.y) < p.r + 6) {
      f.dead = true;
      damagePlayer(f.x, f.y);
    }
  }
  game.foeShots = game.foeShots.filter(f => !f.dead);

  // Particles and floating texts
  for (const pt of game.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= Math.pow(0.1, dt);
    pt.vy *= Math.pow(0.1, dt);
    pt.life -= dt;
  }
  game.particles = game.particles.filter(pt => pt.life > 0);
  for (const tx of game.texts) {
    tx.y -= 40 * dt;
    tx.life -= dt;
  }
  game.texts = game.texts.filter(tx => tx.life > 0);

  // Keep the garden stocked.
  game.respawnT -= dt;
  if (game.respawnT <= 0) {
    game.respawnT = 1.5;
    const count = type => game.items.filter(i => i.type === type).length;
    const off = { offscreen: true };
    if (count('heart') < 70) spawnItem('heart', off);
    if (count('diamond') < 70) spawnItem('diamond', off);
    if (count('bowtie') < 10) spawnItem('bowtie', off);
  }
  game.enemyRespawnT -= dt;
  if (game.enemyRespawnT <= 0) {
    game.enemyRespawnT = 5;
    const wild = type => game.enemies.filter(e => !e.fromBoss && e.type === type).length;
    const off = { offscreen: true };
    if (wild('bee') < MAX_WILD_BEES) spawnEnemy('bee', off);
    else if (wild('beetle') < MAX_WILD_BEETLES) spawnEnemy('beetle', off);
    else if (wild('stopper') < MAX_STOPPERS) spawnStopper(off);
  }

  // End of game
  if (game.endT >= 0) {
    game.endT += dt;
    if (game.endT > 1.6) setState('over');
  }
  if (game.boss.dead) {
    game.boss.deadT += dt;
    if (game.boss.deadT > 4 && state === 'play') {
      save.diamonds += 50;
      writeSave();
      setState('win');
    }
  }
}

function updateBoss(dt, orb, alive) {
  const b = game.boss, p = game.player;
  b.flash = Math.max(0, b.flash - dt);
  b.hitCd = Math.max(0, b.hitCd - dt);
  if (b.dead) return;
  if (!b.active && dist(p.x, p.y, b.cx, b.cy) < ARENA.r + 120) {
    b.active = true;
    addText(b.cx, b.cy - 120, 'Puķu boss!', '#ffd1e8');
  }
  if (!b.active) {
    b.t += dt * 0.3;
    return;
  }
  b.t += dt;
  b.x = b.cx + Math.sin(b.t * 0.6) * 170;
  b.y = b.cy + Math.sin(b.t * 0.9) * 110 - 40;
  b.phase = b.hp <= b.maxHp / 2 ? 2 : 1;
  if (!alive) return;

  b.burstT -= dt;
  if (b.burstT <= 0) {
    const n = b.phase === 1 ? 12 : 18;
    const sp = b.phase === 1 ? 190 : 235;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + b.t * 0.7;
      game.foeShots.push({ kind: 'petal', x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 4 });
    }
    b.burstT = b.phase === 1 ? 2.6 : 1.7;
  }
  if (b.phase === 2) {
    b.aimT -= dt;
    if (b.aimT <= 0) {
      const a0 = Math.atan2(p.y - b.y, p.x - b.x);
      for (const da of [-0.2, 0, 0.2]) {
        game.foeShots.push({ kind: 'seed', x: b.x, y: b.y, vx: Math.cos(a0 + da) * 310, vy: Math.sin(a0 + da) * 310, life: 3 });
      }
      b.aimT = 1.3;
    }
  }
  b.spawnT -= dt;
  if (b.spawnT <= 0) {
    if (game.enemies.filter(e => e.fromBoss).length < MAX_BOSS_BEES) {
      for (let i = 0; i < 2; i++) {
        const e = makeEnemy('bee', b.x + rand(-40, 40), b.y + rand(-40, 40));
        e.fromBoss = true;
        game.enemies.push(e);
      }
    }
    b.spawnT = b.phase === 1 ? 7 : 5;
  }

  // Heart ball against the boss
  if (b.hitCd <= 0 && p.hearts > 0) {
    for (const h of orb) {
      if (dist(h.x, h.y, b.x, b.y) < b.r * 1.2 + 8) {
        p.hearts--;
        b.hitCd = 0.3;
        hitBoss(1);
        break;
      }
    }
  }
  if (!b.dead && dist(p.x, p.y, b.x, b.y) < b.r + p.r) {
    damagePlayer(b.x, b.y);
  }
}

// ---------- Drawing: shapes ----------
function heartPath(s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.9);
  ctx.bezierCurveTo(-s * 1.3, 0, -s * 0.65, -s * 1.05, 0, -s * 0.35);
  ctx.bezierCurveTo(s * 0.65, -s * 1.05, s * 1.3, 0, 0, s * 0.9);
  ctx.closePath();
}

function drawHeart(x, y, s, color = '#ff3d6e') {
  ctx.save();
  ctx.translate(x, y);
  heartPath(s);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,0,30,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-s * 0.4, -s * 0.35, s * 0.22, s * 0.14, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawDiamond(x, y, s, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, -s * 0.25);
  ctx.lineTo(-s * 0.35, -s * 0.65);
  ctx.lineTo(s * 0.35, -s * 0.65);
  ctx.lineTo(s * 0.7, -s * 0.25);
  ctx.lineTo(0, s * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#3fd9ff';
  ctx.fill();
  ctx.strokeStyle = '#0a7fa8';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, -s * 0.25);
  ctx.lineTo(s * 0.7, -s * 0.25);
  ctx.moveTo(-s * 0.2, -s * 0.25);
  ctx.lineTo(0, s * 0.8);
  ctx.lineTo(s * 0.2, -s * 0.25);
  ctx.strokeStyle = 'rgba(10,127,168,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.6);
  ctx.lineTo(-s * 0.05, -s * 0.6);
  ctx.lineTo(-s * 0.25, -s * 0.3);
  ctx.closePath();
  ctx.fill();
  const sp = (Math.sin(t * 2) + 1) / 2;
  if (sp > 0.8) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (sp - 0.8) * 5 + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.95); ctx.lineTo(s * 0.5, -s * 0.45);
    ctx.moveTo(s * 0.25, -s * 0.7); ctx.lineTo(s * 0.75, -s * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBowtie(x, y, s, color, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * s * 0.6, -s * 0.9, side * s * 1.1, -s * 0.55);
    ctx.lineTo(side * s * 1.1, s * 0.55);
    ctx.quadraticCurveTo(side * s * 0.6, s * 0.9, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const [dx, dy] of [[-0.65, -0.2], [0.65, 0.25], [-0.55, 0.3], [0.5, -0.3]]) {
    ctx.beginPath();
    ctx.arc(dx * s, dy * s, s * 0.1, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.25, s * 0.35, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(x, y, r, dir, mouth, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  // Keep the eye on top when facing left.
  if (Math.cos(dir) < 0) ctx.scale(1, -1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, mouth, TAU - mouth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(r * 0.15, -r * 0.5, r * 0.13, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r * 0.19, -r * 0.54, r * 0.05, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBee(e, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const a = Math.atan2(game.player.y - e.y, game.player.x - e.x);
  ctx.rotate(e.fromBoss || dist(e.x, e.y, game.player.x, game.player.y) < e.aggro ? a : e.wa);
  const r = e.r;
  // wings
  const flap = Math.sin(t * 40) * 0.5;
  ctx.fillStyle = 'rgba(230,245,255,0.8)';
  ctx.strokeStyle = 'rgba(120,150,180,0.7)';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, side * r * 0.8, r * 0.55, r * 0.35, side * (0.5 + flap), 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = e.flash > 0 ? '#fff' : (e.fromBoss ? '#ff9f1c' : '#ffd23f');
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.1, r * 0.75, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2b2b2b';
  for (const sx of [-0.6, -0.1, 0.4]) ctx.fillRect(sx * r, -r, r * 0.25, r * 2);
  ctx.restore();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, 0);
  ctx.lineTo(-r * 1.5, -r * 0.15);
  ctx.lineTo(-r * 1.5, r * 0.15);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r * 0.75, -r * 0.25, r * 0.18, 0, TAU);
  ctx.arc(r * 0.75, r * 0.25, r * 0.18, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(r * 0.82, -r * 0.25, r * 0.09, 0, TAU);
  ctx.arc(r * 0.82, r * 0.25, r * 0.09, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBeetle(e, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const chasing = dist(e.x, e.y, game.player.x, game.player.y) < e.aggro;
  ctx.rotate(chasing ? Math.atan2(game.player.y - e.y, game.player.x - e.x) : e.wa);
  const r = e.r;
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  const leg = Math.sin(t * 14) * 0.25;
  for (const side of [-1, 1]) {
    for (const lx of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(lx * r, side * r * 0.5);
      ctx.lineTo(lx * r + leg * r * side * (lx === 0 ? -1 : 1), side * r * 1.15);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(r * 0.8, 0, r * 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = e.flash > 0 ? '#fff' : '#d63031';
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, 0, r * 0.9, r * 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, 0);
  ctx.lineTo(r * 0.85, 0);
  ctx.stroke();
  ctx.fillStyle = '#222';
  for (const [sx, sy] of [[-0.4, -0.4], [0.2, -0.45], [-0.45, 0.4], [0.25, 0.42], [-0.1, -0.2], [-0.1, 0.22]]) {
    ctx.beginPath();
    ctx.arc(sx * r, sy * r, r * 0.13, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  if (e.hp < 3) {
    for (let i = 0; i < e.hp; i++) drawHeart(e.x - 6 + i * 12, e.y - e.r - 10, 4, '#ff6f91');
  }
}

function drawLeaf(x, y, angle, len, w, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -w, len, 0);
  ctx.quadraticCurveTo(len * 0.45, w, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,60,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawBoss(b, t) {
  const p = game.player;
  const sway = Math.sin(t * 1.5) * 0.15;
  const r = b.r;
  ctx.save();
  ctx.translate(b.x, b.y);
  if (b.dead) {
    const k = Math.max(0, 1 - b.deadT / 1.2);
    ctx.globalAlpha = k;
    ctx.scale(1 + (1 - k) * 0.5, 1 + (1 - k) * 0.5);
  }
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 175, 60, 14, 0, 0, TAU);
  ctx.fill();
  // stem
  ctx.strokeStyle = '#2e8b2e';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 172);
  ctx.quadraticCurveTo(Math.sin(t * 1.2) * 25, 90, 0, 10);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // two big leaves
  drawLeaf(-6, 120, Math.PI + 0.55 + sway, 105, 38, '#3cb043');
  drawLeaf(6, 105, -0.55 - sway, 105, 38, '#45c24d');
  // petals
  const petal = b.phase === 2 ? '#e0245e' : '#ff69b4';
  const petalEdge = b.phase === 2 ? '#8a0e36' : '#c2185b';
  for (let i = 0; i < 10; i++) {
    ctx.save();
    ctx.rotate(i * TAU / 10 + t * 0.3);
    ctx.beginPath();
    ctx.ellipse(r * 0.95, 0, r * 0.62, r * 0.33, 0, 0, TAU);
    ctx.fillStyle = petal;
    ctx.fill();
    ctx.strokeStyle = petalEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  // flower centre / face
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.fillStyle = '#ffcc33';
  ctx.fill();
  ctx.strokeStyle = '#d99a00';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,130,0,0.35)';
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, d = (i % 4 + 1) * r * 0.12;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d + r * 0.2, 2.5, 0, TAU);
    ctx.fill();
  }
  const look = Math.atan2(p.y - b.y, p.x - b.x);
  for (const side of [-1, 1]) {
    const ex = side * r * 0.24, ey = -r * 0.1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(ex + Math.cos(look) * r * 0.05, ey + Math.sin(look) * r * 0.05, r * 0.065, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#5a3a00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex - side * r * 0.16, ey - r * 0.25);
    ctx.lineTo(ex + side * r * 0.12, ey - r * 0.13);
    ctx.stroke();
  }
  ctx.strokeStyle = '#5a3a00';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (b.phase === 2) {
    ctx.moveTo(-r * 0.22, r * 0.32);
    for (let i = 1; i <= 6; i++) ctx.lineTo(-r * 0.22 + i * r * 0.073, r * (i % 2 ? 0.24 : 0.32));
  } else {
    ctx.arc(0, r * 0.4, r * 0.2, Math.PI * 1.2, Math.PI * 1.8);
  }
  ctx.stroke();
  if (b.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawBushShape(b) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(b.x + 6, b.y + b.r * 0.55, b.r * 1.05, b.r * 0.5, 0, 0, TAU);
  ctx.fill();
  const g = Math.floor(110 + b.shade * 200);
  ctx.fillStyle = `rgb(34,${g - 20},40)`;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgb(52,${g + 10},55)`;
  for (const bl of b.blobs) {
    ctx.beginPath();
    ctx.arc(b.x + bl.dx, b.y + bl.dy, bl.r, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.35, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8304f';
  for (const be of b.berries) {
    ctx.beginPath();
    ctx.arc(b.x + be.dx, b.y + be.dy, 3.5, 0, TAU);
    ctx.fill();
  }
  for (const f of b.flowers) drawBushFlower(f, b.x + f.dx, b.y + f.dy);
}

function drawBushFlower(f, x, y) {
  const s = f.s;
  if (f.kind === 'rose') {
    ctx.fillStyle = '#2f7d2a';
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(f.rot) * s, y + Math.sin(f.rot) * s, s * 0.6, s * 0.3, f.rot, 0, TAU);
    ctx.fill();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,0,20,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.68, f.rot, f.rot + 4.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s * 0.35, f.rot + 2, f.rot + 6.5);
    ctx.stroke();
  } else if (f.kind === 'lily') {
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = f.rot + i * TAU / 6;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * s * 0.62, y + Math.sin(a) * s * 0.62, s * 0.78, s * 0.26, a, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#b5541c';
    for (let i = 0; i < 3; i++) {
      const a = f.rot + i * TAU / 3 + 0.5;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3, 1.4, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = f.color;
    for (let i = 0; i < 8; i++) {
      const a = f.rot + i * TAU / 8;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.5, s * 0.2, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffc400';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.35, 0, TAU);
    ctx.fill();
  }
}

function drawTree(tr, faded) {
  const cx = tr.x, cy = canopyY(tr);
  // ground shadow and trunk
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(tr.x + 10, tr.y + 6, tr.vr * 0.75, tr.vr * 0.32, 0, 0, TAU);
  ctx.fill();
  const tw = tr.r * 0.55;
  ctx.fillStyle = '#7a5230';
  ctx.strokeStyle = '#4a3018';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tr.x - tw * 1.5, tr.y + 4);
  ctx.quadraticCurveTo(tr.x - tw, tr.y - 4, tr.x - tw, tr.y - tr.vr * 0.5);
  ctx.lineTo(tr.x + tw, tr.y - tr.vr * 0.5);
  ctx.quadraticCurveTo(tr.x + tw, tr.y - 4, tr.x + tw * 1.5, tr.y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(40,25,10,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tr.x - tw * 0.3, tr.y - 2); ctx.lineTo(tr.x - tw * 0.2, tr.y - tr.vr * 0.35);
  ctx.moveTo(tr.x + tw * 0.4, tr.y - 4); ctx.lineTo(tr.x + tw * 0.3, tr.y - tr.vr * 0.3);
  ctx.stroke();

  if (faded) ctx.globalAlpha = 0.45;
  const g = Math.floor(95 + tr.shade * 200);
  if (tr.conifer) {
    const layers = [['#1a4f2a', 1], [`rgb(34,${g + 5},50)`, 0.75], [`rgb(52,${g + 35},62)`, 0.48], [`rgb(70,${g + 60},74)`, 0.22]];
    layers.forEach(([color, k], li) => {
      const R = tr.vr * k;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const a = tr.rot + li * 0.35 + i * TAU / 18;
        const rr = i % 2 ? R * 0.7 : R;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      if (li === 0) {
        ctx.strokeStyle = 'rgba(10,40,15,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  } else {
    // scalloped leafy canopy, warmer green than the bushes
    const edge = () => {
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = tr.rot + i * TAU / 14;
        ctx.moveTo(cx + Math.cos(a) * tr.vr * 0.8 + tr.vr * 0.26, cy + Math.sin(a) * tr.vr * 0.8);
        ctx.arc(cx + Math.cos(a) * tr.vr * 0.8, cy + Math.sin(a) * tr.vr * 0.8, tr.vr * 0.26, 0, TAU);
      }
    };
    ctx.strokeStyle = 'rgba(20,45,10,0.7)';
    ctx.lineWidth = 3;
    edge();
    ctx.stroke();
    ctx.fillStyle = `rgb(52,${g + 5},28)`;
    edge();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, tr.vr * 0.85, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgb(78,${g + 40},38)`;
    for (const bl of tr.blobs) {
      ctx.beginPath();
      ctx.arc(cx + bl.dx * 0.7 - 5, cy + bl.dy * 0.7 - 6, bl.r * 0.62, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = `rgb(110,${g + 75},50)`;
    for (const bl of tr.blobs) {
      ctx.beginPath();
      ctx.arc(cx + bl.dx * 0.55 - 10, cy + bl.dy * 0.55 - 12, bl.r * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#e8352f';
    for (const ap of tr.apples) {
      ctx.beginPath();
      ctx.arc(cx + ap.dx, cy + ap.dy, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(cx + ap.dx - 1.5, cy + ap.dy - 1.5, 1.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8352f';
    }
  }
  ctx.globalAlpha = 1;
}

// Beaver-frog: frog body and eyes, beaver teeth and tail, two legs, no arms.
function drawStopper(e, t) {
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, r * 1.05, r * (0.9 - e.hopH / 60), r * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.translate(0, -e.hopH);
  ctx.scale(e.face, 1);

  // flat beaver tail, behind the body
  ctx.save();
  ctx.translate(-r * 0.6, r * 0.55);
  ctx.rotate(0.35 + Math.sin(t * 3) * 0.12);
  const tail = () => { ctx.beginPath(); ctx.ellipse(-r * 0.65, 0, r * 0.75, r * 0.34, 0, 0, TAU); };
  tail();
  ctx.fillStyle = '#8a5428';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(50,25,5,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const x = -r * 1.35 + k * r * 0.32;
    ctx.moveTo(x, -r * 0.4); ctx.lineTo(x + r * 0.3, r * 0.4);
    ctx.moveTo(x + r * 0.3, -r * 0.4); ctx.lineTo(x, r * 0.4);
  }
  ctx.stroke();
  ctx.restore();
  tail();
  ctx.strokeStyle = '#4a2a10';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const body = e.flash > 0 ? '#ffffff' : '#6fae4a';
  const dark = '#4f8f3a';
  // two legs with webbed feet
  for (const side of [-1, 1]) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(side * r * 0.42, r * 0.72, r * 0.3, r * 0.22, side * 0.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    const fx = side * r * 0.5, fy = r * 0.98;
    ctx.moveTo(fx - r * 0.12, fy - r * 0.08);
    ctx.lineTo(fx - r * 0.3, fy + r * 0.1);
    ctx.lineTo(fx - r * 0.1, fy + r * 0.04);
    ctx.lineTo(fx, fy + r * 0.14);
    ctx.lineTo(fx + r * 0.1, fy + r * 0.04);
    ctx.lineTo(fx + r * 0.3, fy + r * 0.1);
    ctx.lineTo(fx + r * 0.12, fy - r * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  // pear-shaped body with pale belly
  ctx.fillStyle = body;
  ctx.strokeStyle = 'rgba(30,60,20,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 0.82, r * 0.88, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#dbe8a6';
  ctx.beginPath();
  ctx.ellipse(r * 0.05, r * 0.38, r * 0.48, r * 0.45, 0, 0, TAU);
  ctx.fill();
  // bulging frog eyes
  const p = game.player;
  const look = Math.atan2(p.y - e.y, (p.x - e.x) * e.face);
  for (const side of [-1, 1]) {
    const ex = side * r * 0.36 + r * 0.08, ey = -r * 0.62;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey - r * 0.02, r * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(ex + Math.cos(look) * r * 0.07, ey + Math.sin(look) * r * 0.06, r * 0.1, r * 0.06, 0, 0, TAU);
    ctx.fill();
  }
  // mouth and beaver buck teeth
  ctx.strokeStyle = '#2d4a1c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.18);
  ctx.quadraticCurveTo(r * 0.1, e.sayT > 0 ? r * 0.05 : -r * 0.08, r * 0.5, -r * 0.18);
  ctx.stroke();
  ctx.fillStyle = '#fffbe8';
  ctx.strokeStyle = '#8a7a50';
  ctx.lineWidth = 1;
  for (const tx of [0.02, 0.17]) {
    ctx.fillRect(tx * r, -r * 0.15, r * 0.14, r * 0.2);
    ctx.strokeRect(tx * r, -r * 0.15, r * 0.14, r * 0.2);
  }
  ctx.restore();
  if (e.hp < 4) {
    for (let i = 0; i < e.hp; i++) drawHeart(e.x - (e.hp - 1) * 6 + i * 12, e.y - e.r * 1.75 - e.hopH, 4, '#ff6f91');
  }
}

function drawStopBubble(e) {
  const pop = Math.min(1, (1.6 - e.sayT) * 8);
  const x = e.x, y = e.y - e.r * 2.3 - e.hopH;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pop, pop);
  ctx.globalAlpha = Math.min(1, e.sayT * 4);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#c62828';
  ctx.lineWidth = 3;
  roundRect(-38, -18, 76, 32, 12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8, 13);
  ctx.lineTo(0, 26);
  ctx.lineTo(8, 13);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8, 14.5);
  ctx.lineTo(0, 26);
  ctx.lineTo(8, 14.5);
  ctx.stroke();
  ctx.fillStyle = '#c62828';
  ctx.font = `bold 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STOP!', 0, -1);
  ctx.restore();
}

function drawDecor(d) {
  if (d.type === 'tuft') {
    ctx.strokeStyle = '#4e9a35';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const k of [-1, 0, 1]) {
      ctx.moveTo(d.x + k * 3, d.y);
      ctx.lineTo(d.x + k * 5 + d.rot * d.s, d.y - d.s * (k === 0 ? 1.2 : 0.8));
    }
    ctx.stroke();
  } else if (d.type === 'flower') {
    ctx.fillStyle = d.color;
    for (let i = 0; i < d.petals; i++) {
      const a = d.rot + i * TAU / d.petals;
      ctx.beginPath();
      ctx.arc(d.x + Math.cos(a) * d.s * 0.7, d.y + Math.sin(a) * d.s * 0.7, d.s * 0.55, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = d.color === '#ffe14d' ? '#c86b00' : '#ffd23f';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.s * 0.45, 0, TAU);
    ctx.fill();
  } else if (d.type === 'plant') {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      drawLeaf(0, 0, a, d.s, d.s * 0.28, i % 2 ? '#3f9e3a' : '#57b84a');
    }
    ctx.restore();
  } else if (d.type === 'tulip') {
    ctx.strokeStyle = '#2f7d2a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x, d.y - d.s * 1.6);
    ctx.stroke();
    drawLeaf(d.x, d.y - d.s * 0.4, -2.3, d.s * 0.9, d.s * 0.25, '#3f9e3a');
    ctx.fillStyle = d.color;
    const ty = d.y - d.s * 1.8;
    ctx.beginPath();
    ctx.moveTo(d.x - d.s * 0.55, ty - d.s * 0.4);
    ctx.lineTo(d.x - d.s * 0.25, ty);
    ctx.lineTo(d.x, ty - d.s * 0.45);
    ctx.lineTo(d.x + d.s * 0.25, ty);
    ctx.lineTo(d.x + d.s * 0.55, ty - d.s * 0.4);
    ctx.quadraticCurveTo(d.x + d.s * 0.6, ty + d.s * 0.5, d.x, ty + d.s * 0.5);
    ctx.quadraticCurveTo(d.x - d.s * 0.6, ty + d.s * 0.5, d.x - d.s * 0.55, ty - d.s * 0.4);
    ctx.fill();
  }
}

// ---------- Drawing: scene ----------
let cam = { x: 0, y: 0 };

function strokeLines(width, color) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  for (const line of paths) {
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    ctx.stroke();
  }
}

function drawPaths() {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeLines(PATH_W + 10, '#a8824c');
  strokeLines(PATH_W, '#dcbc80');
  strokeLines(PATH_W * 0.45, 'rgba(255,240,205,0.3)');
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.fillStyle = 'rgba(130,100,60,0.55)';
  for (const pb of pebbles) {
    if (!visible(pb.x, pb.y, 10)) continue;
    ctx.beginPath();
    ctx.ellipse(pb.x, pb.y, pb.r * 1.3, pb.r, pb.rot, 0, TAU);
    ctx.fill();
  }
}

function visible(x, y, m) {
  return x > cam.x - m && x < cam.x + VW + m && y > cam.y - m && y < cam.y + VH + m;
}

function drawWorld() {
  const p = game.player;
  cam.x = clamp(p.x - VW / 2, Math.min(0, WORLD_W - VW), Math.max(0, WORLD_W - VW));
  cam.y = clamp(p.y - VH / 2, Math.min(0, WORLD_H - VH), Math.max(0, WORLD_H - VH));
  if (VW > WORLD_W) cam.x = (WORLD_W - VW) / 2;
  if (VH > WORLD_H) cam.y = (WORLD_H - VH) / 2;
  const sx = game.shake > 0 ? rand(-game.shake, game.shake) : 0;
  const sy = game.shake > 0 ? rand(-game.shake, game.shake) : 0;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#2f5d1e';
  ctx.fillRect(0, 0, VW, VH);
  ctx.translate(-cam.x + sx, -cam.y + sy);

  // Grass with soft lighter patches
  ctx.fillStyle = '#7ccf5a';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const tile = 400;
  for (let gx = Math.floor(cam.x / tile) - 1; gx <= (cam.x + VW) / tile + 1; gx++) {
    for (let gy = Math.floor(cam.y / tile) - 1; gy <= (cam.y + VH) / tile + 1; gy++) {
      if (gx < 0 || gy < 0 || gx >= WORLD_W / tile || gy >= WORLD_H / tile) continue;
      if ((gx * 7 + gy * 13) % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,200,0.08)';
        ctx.beginPath();
        ctx.arc(gx * tile + 200 + ((gx * 37) % 90) - 45, gy * tile + 200 + ((gy * 53) % 90) - 45, 170, 0, TAU);
        ctx.fill();
      }
    }
  }

  // Boss arena ground
  ctx.fillStyle = '#b7df84';
  ctx.beginPath();
  ctx.arc(ARENA.x, ARENA.y, ARENA.r - 10, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,40,0.25)';
  ctx.lineWidth = 6;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.arc(ARENA.x, ARENA.y, ARENA.r - 80, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  drawPaths();

  for (const d of decor) if (visible(d.x, d.y, 40)) drawDecor(d);

  // Click-to-move route and target marker
  if (p.route && p.route.length && game.endT < 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const wp of p.route) ctx.lineTo(wp.x, wp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const goal = p.route[p.route.length - 1];
    const pulse = 10 + Math.sin(game.t * 6) * 3;
    ctx.strokeStyle = '#fff7a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, pulse, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(goal.x - 5, goal.y - 5); ctx.lineTo(goal.x + 5, goal.y + 5);
    ctx.moveTo(goal.x + 5, goal.y - 5); ctx.lineTo(goal.x - 5, goal.y + 5);
    ctx.stroke();
  }

  const t = game.t;
  for (const it of game.items) {
    if (!visible(it.x, it.y, 30)) continue;
    const bob = Math.sin(it.phase) * 3;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(it.x, it.y + 12, 9, 3, 0, 0, TAU);
    ctx.fill();
    if (it.type === 'diamond') drawDiamond(it.x, it.y + bob, 13, it.phase);
    else if (it.type === 'heart') drawHeart(it.x, it.y + bob, 11);
    else drawBowtie(it.x, it.y + bob, 13, it.color, Math.sin(it.phase * 0.7) * 0.25);
  }

  for (const b of bushes) if (visible(b.x, b.y, b.r + 20)) drawBushShape(b);

  for (const e of game.enemies) {
    if (!visible(e.x, e.y, 40)) continue;
    if (e.type === 'bee') drawBee(e, t + e.t);
    else if (e.type === 'stopper') drawStopper(e, t + e.t);
    else drawBeetle(e, t + e.t);
  }

  const b = game.boss;
  if ((!b.dead || b.deadT < 1.2) && visible(b.x, b.y, 260)) drawBoss(b, b.t);

  // Player and heart ball
  const p2 = game.player;
  if (game.endT < 0) {
    const orb = orbitHearts(p2, t);
    for (const h of orb) drawHeart(h.x, h.y, 9);
    const blink = p2.inv > 0 && Math.floor(p2.inv * 12) % 2 === 0;
    if (!blink) {
      if (p2.boosts.star > 0) {
        ctx.fillStyle = `rgba(255,255,150,${0.25 + 0.15 * Math.sin(t * 12)})`;
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, p2.r + 10, 0, TAU);
        ctx.fill();
      }
      const mouth = 0.04 + 0.32 * Math.abs(Math.sin(p2.mouthT));
      const r = p2.r * (1 + Math.sin(p2.grow * 20) * p2.grow * 0.3);
      drawPlayer(p2.x, p2.y, r, p2.dir, mouth, colorFill(save.color, t));
    }
  }

  // Tree canopies cover whatever walks beneath; they turn see-through when the player is under one.
  for (const tr of trees) {
    if (!visible(tr.x, canopyY(tr), tr.vr + 40)) continue;
    drawTree(tr, dist(tr.x, canopyY(tr), p2.x, p2.y) < tr.vr + p2.r * 0.5);
  }

  for (const s of game.shots) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(s.rot) * 0.4);
    drawHeart(0, 0, 10);
    ctx.restore();
  }

  for (const f of game.foeShots) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(Math.atan2(f.vy, f.vx));
    ctx.beginPath();
    if (f.kind === 'petal') {
      ctx.ellipse(0, 0, 11, 5.5, 0, 0, TAU);
      ctx.fillStyle = b.phase === 2 ? '#e0245e' : '#ff69b4';
    } else {
      ctx.ellipse(0, 0, 7, 4, 0, 0, TAU);
      ctx.fillStyle = '#6b3e12';
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,0,20,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.font = `bold 18px ${FONT}`;
  for (const tx of game.texts) {
    ctx.globalAlpha = Math.min(1, tx.life * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(tx.text, tx.x, tx.y);
    ctx.fillStyle = tx.color;
    ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;

  for (const e of game.enemies) {
    if (e.type === 'stopper' && e.sayT > 0 && visible(e.x, e.y, 80)) drawStopBubble(e);
  }

  // Hedge-like world border
  ctx.strokeStyle = '#2f5d1e';
  ctx.lineWidth = 24;
  ctx.strokeRect(-12, -12, WORLD_W + 24, WORLD_H + 24);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---------- Drawing: HUD and screens ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function outlinedText(text, x, y, size, color = '#fff', align = 'left') {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size / 5);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHUD() {
  const p = game.player;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(10, 10, 220, 112, 12);
  ctx.fill();

  drawDiamond(32, 34, 14, game.t);
  outlinedText(String(save.diamonds), 52, 34, 20);
  drawHeart(32, 64, 11);
  outlinedText(`${p.hearts} / ${maxHearts(p)}`, 52, 64, 20);

  outlinedText('Dzīvība', 22, 96, 14);
  const bw = 130;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(88, 88, bw, 16, 8);
  ctx.fill();
  ctx.fillStyle = p.hp / p.maxHp > 0.35 ? '#5ee06a' : '#ff5252';
  if (p.hp > 0) {
    roundRect(88, 88, bw * p.hp / p.maxHp, 16, 8);
    ctx.fill();
  }
  outlinedText(`${p.hp}/${p.maxHp}`, 88 + bw / 2, 96, 12, '#fff', 'center');

  // Active boosts
  let by = 140;
  for (const k of ['speed', 'star', 'magnet']) {
    if (p.boosts[k] <= 0) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(10, by - 14, 160, 28, 10);
    ctx.fill();
    outlinedText(`${BOOST_NAMES[k]} ${p.boosts[k].toFixed(1)}s`, 22, by, 15, '#9ff7ff');
    by += 34;
  }

  // Boss health bar
  const b = game.boss;
  if (b.active && !b.dead) {
    const w = Math.min(420, VW - 260);
    const x = (VW - w) / 2;
    outlinedText('Puķu boss', VW / 2, 22, 16, '#ffd1e8', 'center');
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(x, 34, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = b.phase === 2 ? '#e0245e' : '#ff69b4';
    roundRect(x, 34, w * b.hp / b.maxHp, 16, 8);
    ctx.fill();
  }

  drawMinimap();

  if (game.t < 12) {
    ctx.globalAlpha = Math.min(1, 12 - game.t);
    outlinedText('Bultiņas vai klikšķis — kustība   ·   Atstarpe vai labā poga — mest sirsniņu   ·   P — veikals / pauze', VW / 2, VH - 26, 16, '#fff', 'center');
    ctx.globalAlpha = 1;
  }
}

function drawMinimap() {
  const size = Math.min(160, VW * 0.25);
  const x0 = VW - size - 12, y0 = 12;
  const k = size / WORLD_W;
  ctx.fillStyle = 'rgba(30,70,20,0.75)';
  roundRect(x0 - 4, y0 - 4, size + 8, size + 8, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(30,90,30,0.9)';
  ctx.strokeStyle = 'rgba(220,188,128,0.85)';
  ctx.lineWidth = 2;
  for (const line of paths) {
    ctx.beginPath();
    ctx.moveTo(x0 + line[0].x * k, y0 + line[0].y * k);
    for (let i = 1; i < line.length; i += 4) ctx.lineTo(x0 + line[i].x * k, y0 + line[i].y * k);
    ctx.stroke();
  }
  for (const b of bushes) ctx.fillRect(x0 + b.x * k - 1, y0 + b.y * k - 1, 2, 2);
  ctx.fillStyle = 'rgba(15,55,20,0.9)';
  for (const tr of trees) {
    ctx.beginPath();
    ctx.arc(x0 + tr.x * k, y0 + canopyY(tr) * k, Math.max(2, tr.vr * k), 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,180,220,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x0 + ARENA.x * k, y0 + ARENA.y * k, ARENA.r * k, 0, TAU);
  ctx.stroke();
  const b = game.boss;
  if (!b.dead) {
    ctx.fillStyle = '#ff69b4';
    ctx.beginPath();
    ctx.arc(x0 + b.x * k, y0 + b.y * k, 4, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + cam.x * k, y0 + cam.y * k, VW * k, VH * k);
  ctx.fillStyle = colorFill(save.color, game.t);
  ctx.beginPath();
  ctx.arc(x0 + game.player.x * k, y0 + game.player.y * k, 3.5, 0, TAU);
  ctx.fill();
}

function dim(alpha = 0.55) {
  ctx.fillStyle = `rgba(10,30,10,${alpha})`;
  ctx.fillRect(0, 0, VW, VH);
}

function drawTitle() {
  dim(0.5);
  const cx = VW / 2, cy = VH / 2;
  const t = performance.now() / 1000;
  const scale = Math.min(1, VW / 700);
  outlinedText('Sirsiņbumba', cx, cy - 150 * scale, 64 * scale, '#ffd1e8', 'center');
  outlinedText('Heart Ball', cx, cy - 100 * scale, 22 * scale, '#fff', 'center');
  // little animated player with heart ball
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = t * 2.4 + i * TAU / n;
    drawHeart(cx + Math.cos(a) * 52, cy - 15 + Math.sin(a) * 52, 9);
  }
  drawPlayer(cx, cy - 15, 26, 0, 0.04 + 0.32 * Math.abs(Math.sin(t * 6)), colorFill(save.color, t));

  const lines = [
    'Vāc dimantus, sirsniņas un ēd tauriņus!',
    'Sirsniņas riņķo ap tevi un sargā no ienaidniekiem.',
    'Atrodi un uzvari Puķu bosu dārza stūrī.',
  ];
  lines.forEach((l, i) => outlinedText(l, cx, cy + 70 * scale + i * 26 * scale, 17 * scale, '#fff', 'center'));
  outlinedText('Bultiņas vai klikšķis — kustība · Atstarpe vai labā poga — mest sirsniņu · P — veikals', cx, cy + 165 * scale, 15 * scale, '#c9f7b0', 'center');
  outlinedText('Pa celiņiem var skriet ātrāk!', cx, cy + 188 * scale, 15 * scale, '#c9f7b0', 'center');
  if (Math.floor(t * 2) % 2 === 0) {
    outlinedText('Spied Enter, lai sāktu', cx, cy + 225 * scale, 24 * scale, '#fff7a8', 'center');
  }
}

function drawShop() {
  dim(0.65);
  const t = performance.now() / 1000;
  const cols = VW < 640 ? 2 : 4;
  const rows = Math.ceil(COLORS.length / cols);
  const cw = Math.min(150, (VW - 40) / cols - 12), ch = 150;
  const gw = cols * (cw + 12) - 12;
  const x0 = (VW - gw) / 2;
  const y0 = Math.max(110, VH / 2 - rows * (ch + 12) / 2);
  outlinedText(shopReturn === 'play' ? 'Pauze — Veikals' : 'Veikals', VW / 2, y0 - 70, 36, '#ffd1e8', 'center');
  drawDiamond(VW / 2 - 40, y0 - 30, 13, t);
  outlinedText(String(save.diamonds), VW / 2 - 22, y0 - 30, 22, '#fff', 'left');

  shopCards = [];
  COLORS.forEach((c, i) => {
    const x = x0 + (i % cols) * (cw + 12);
    const y = y0 + Math.floor(i / cols) * (ch + 12);
    shopCards.push({ x, y, w: cw, h: ch, i });
    const owned = save.owned.includes(c.id);
    const selected = save.color === c.id;
    ctx.fillStyle = i === shopSel ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)';
    roundRect(x, y, cw, ch, 14);
    ctx.fill();
    if (i === shopSel) {
      ctx.strokeStyle = '#fff7a8';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    drawPlayer(x + cw / 2, y + 50, 26, 0, 0.3, colorFill(c.id, t));
    outlinedText(c.name, x + cw / 2, y + 98, 16, '#fff', 'center');
    if (selected) {
      outlinedText('Izvēlēta', x + cw / 2, y + 126, 15, '#9ff79f', 'center');
    } else if (owned) {
      outlinedText('Pieder', x + cw / 2, y + 126, 15, '#c9f7b0', 'center');
    } else {
      drawDiamond(x + cw / 2 - 22, y + 126, 9, 0);
      const ok = save.diamonds >= c.price;
      outlinedText(String(c.price), x + cw / 2 - 8, y + 126, 16, ok ? '#7ff3ff' : '#ff9b9b', 'left');
    }
  });

  const yEnd = y0 + rows * (ch + 12) + 20;
  outlinedText('Bultiņas — izvēlēties · Enter — pirkt / izvēlēties · P vai Esc — atpakaļ', VW / 2, yEnd, 15, '#fff', 'center');
  if (shopMsg && performance.now() / 1000 - shopMsg.t < 1.5) {
    outlinedText(shopMsg.text, VW / 2, yEnd + 34, 20, shopMsg.color, 'center');
  }
}

function drawEnd(won) {
  dim(0.55);
  const cx = VW / 2, cy = VH / 2;
  if (won) {
    outlinedText('Uzvara!', cx, cy - 60, 64, '#fff7a8', 'center');
    outlinedText('Tu uzvarēji Puķu bosu!  +50 dimanti', cx, cy, 22, '#fff', 'center');
  } else {
    outlinedText('Tu zaudēji!', cx, cy - 60, 60, '#ff9b9b', 'center');
    outlinedText('Dimanti paliek tavā kabatā.', cx, cy, 22, '#fff', 'center');
  }
  drawDiamond(cx - 30, cy + 40, 13, performance.now() / 1000);
  outlinedText(String(save.diamonds), cx - 12, cy + 40, 22, '#fff', 'left');
  if (stateT > 0.8) {
    outlinedText('Enter — spēlēt vēlreiz · P — veikals', cx, cy + 90, 20, '#c9f7b0', 'center');
  }
}

// ---------- Shop logic ----------
function shopAction() {
  const c = COLORS[shopSel];
  const now = performance.now() / 1000;
  if (save.owned.includes(c.id)) {
    save.color = c.id;
    shopMsg = { text: 'Krāsa izvēlēta!', color: '#9ff79f', t: now };
  } else if (save.diamonds >= c.price) {
    save.diamonds -= c.price;
    save.owned.push(c.id);
    save.color = c.id;
    shopMsg = { text: 'Nopirkts!', color: '#fff7a8', t: now };
  } else {
    shopMsg = { text: `Nepietiek dimantu! Vajag vēl ${c.price - save.diamonds}.`, color: '#ff9b9b', t: now };
  }
  writeSave();
}

function openShop() {
  pointer.held = false;
  shopReturn = state;
  shopSel = Math.max(0, COLORS.findIndex(c => c.id === save.color));
  shopMsg = null;
  setState('shop');
}

function setState(s) {
  state = s;
  stateT = 0;
}

// ---------- Input ----------
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  const code = e.code;
  const confirm = code === 'Enter' || code === 'NumpadEnter';
  const back = code === 'KeyP' || code === 'Escape';

  if (state === 'title') {
    if (confirm || code === 'Space') setState('play');
    else if (code === 'KeyP') openShop();
  } else if (state === 'play') {
    if (back) openShop();
  } else if (state === 'shop') {
    const cols = VW < 640 ? 2 : 4;
    if (code === 'ArrowLeft') shopSel = (shopSel + COLORS.length - 1) % COLORS.length;
    else if (code === 'ArrowRight') shopSel = (shopSel + 1) % COLORS.length;
    else if (code === 'ArrowUp') shopSel = (shopSel - cols + COLORS.length) % COLORS.length;
    else if (code === 'ArrowDown') shopSel = (shopSel + cols) % COLORS.length;
    else if (confirm || code === 'Space') { if (!e.repeat) shopAction(); }
    else if (back) setState(shopReturn);
  } else if (state === 'over' || state === 'win') {
    if (stateT < 0.8) return;
    if (confirm) { newGame(); setState('play'); }
    else if (code === 'KeyP') openShop();
  }
});

window.addEventListener('keyup', e => { keys[e.code] = false; });

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  pointer.held = false;
  if (state === 'play') openShop();
});

// Point-and-click: left button walks there (hold to keep steering), right button throws a heart.
const pointer = { held: false, x: 0, y: 0, retargetT: 0 };

canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || game.endT >= 0) return;
  if (e.button === 0) {
    pointer.held = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.retargetT = 0.15;
    setMoveTarget(e.clientX + cam.x, e.clientY + cam.y);
    canvas.setPointerCapture(e.pointerId);
  } else if (e.button === 2) {
    const p = game.player;
    p.dir = Math.atan2(e.clientY + cam.y - p.y, e.clientX + cam.x - p.x);
    throwHeart();
  }
});
canvas.addEventListener('pointermove', e => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
const releasePointer = () => { pointer.held = false; };
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('click', e => {
  if (state === 'title') { setState('play'); return; }
  if (state !== 'shop') return;
  for (const c of shopCards) {
    if (e.clientX >= c.x && e.clientX <= c.x + c.w && e.clientY >= c.y && e.clientY <= c.y + c.h) {
      shopSel = c.i;
      shopAction();
    }
  }
});

// ---------- Main loop ----------
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stateT += dt;
  // The world keeps running briefly after victory so the boss's diamonds can be collected.
  if (state === 'play') update(dt);

  drawWorld();
  if (state === 'play') drawHUD();
  else if (state === 'title') drawTitle();
  else if (state === 'shop') drawShop();
  else if (state === 'over') drawEnd(false);
  else if (state === 'win') drawEnd(true);

  requestAnimationFrame(frame);
}

loadSave();
buildWorld();
newGame();
requestAnimationFrame(frame);
