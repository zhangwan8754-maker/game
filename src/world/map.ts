/**
 * The arena as a height field. Every solid rises from the ground (no bridges or overhangs), so
 * the world is one function height(x, z): physics walks on it, paint lands on it, bots path over
 * it. Solids are boxes and ramps; the layout is point-symmetric (x, z) -> (-x, -z) so both
 * teams get the same plaza.
 */
import type { Team } from "../config";

export interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Top height; a ramp rises from `lo` to `h` along its axis toward `dir`. */
  h: number;
  ramp?: { axis: "x" | "z"; dir: 1 | -1; lo: number };
  /** Paint-proof (a spawn pad's glass, the tower's roof trim): walkable, never inked. */
  noPaint?: boolean;
  kind?: "block" | "crate" | "base" | "tower" | "wall";
}

export interface MapDef {
  name: string;
  blurb: string;
  halfX: number;
  halfZ: number;
  solids: Solid[];
  /** Spawn points per team (on their base). */
  spawns: [number, number][][];
  /** Grid cells per metre (paint + nav resolution). */
  res: number;
  time: "day" | "dusk";
}

function mirror(s: Solid): Solid {
  const m: Solid = { ...s, x0: -s.x1, x1: -s.x0, z0: -s.z1, z1: -s.z0 };
  if (s.ramp) m.ramp = { ...s.ramp, dir: (s.ramp.dir * -1) as 1 | -1 };
  return m;
}

function sym(half: Solid[]): Solid[] {
  return [...half, ...half.map(mirror)];
}

const box = (x0: number, x1: number, z0: number, z1: number, h: number, kind: Solid["kind"] = "block"): Solid => ({ x0, x1, z0, z1, h, kind });
const ramp = (x0: number, x1: number, z0: number, z1: number, lo: number, h: number, axis: "x" | "z", dir: 1 | -1): Solid => ({ x0, x1, z0, z1, h, ramp: { axis, dir, lo }, kind: "block" });

/** Harbor Plaza: bases on raised decks at each end, a tower in the middle, three lanes. */
const PLAZA: MapDef = {
  name: "港口广场",
  blurb: "大地图（原版 4v4 尺寸）：两端高台，中间一座塔，三条路。",
  halfX: 24,
  halfZ: 42,
  res: 4,
  time: "day",
  solids: [
    ...sym([
      // Team 0's deck (z < 0) and the ramps off it.
      { ...box(-8, 8, -42, -33, 1.6, "base") },
      ramp(-3, 3, -33, -28, 0, 1.6, "z", -1),
      ramp(8, 12, -40, -35, 0, 1.6, "x", -1),
      // Deck rails (low: jumpable).
      box(-8, -3, -33, -32.4, 2.5, "wall"),
      box(3, 8, -33, -32.4, 2.5, "wall"),
      // Cover in front of the deck.
      box(-12, -9, -27, -24, 2.2, "crate"),
      box(9, 12, -27, -24, 2.2, "crate"),
      box(-2, 2, -22, -20.5, 1.1),
      // Side lanes: long low walls and a raised walkway.
      box(-24, -17, -18, -14, 1.2),
      ramp(-17, -13, -18, -14, 0, 1.2, "x", -1),
      box(17, 24, -22, -10, 2.4),
      ramp(14, 17, -22, -18, 0, 2.4, "x", 1),
      box(-10, -7, -13, -10, 2.2, "crate"),
      box(6, 8, -14, -9, 1.0),
      // Mid approach.
      box(-5, -3, -10, -7, 2.2, "crate"),
      box(9, 13, -6, -2, 1.2),
    ]),
    // The tower: one piece, ramps up both long sides (the ramps mirror onto each other).
    { ...box(-4, 4, -4, 4, 3.0, "tower") },
    ramp(4, 9, -3, 3, 0, 3.0, "x", -1),
    ramp(-9, -4, -3, 3, 0, 3.0, "x", 1),
  ],
  spawns: [
    [
      [-4, -38],
      [-1.4, -39],
      [1.4, -39],
      [4, -38],
    ],
    [
      [4, 38],
      [1.4, 39],
      [-1.4, 39],
      [-4, 38],
    ],
  ],
};

/** Canal Yard: tighter, with a sunken canal across the middle and crates everywhere. */
const YARD: MapDef = {
  name: "运河货场",
  blurb: "中等地图：到处是货箱，中间一条下沉的运河，两侧有走道。",
  halfX: 20,
  halfZ: 36,
  res: 4,
  time: "dusk",
  solids: [
    ...sym([
      box(-7, 7, -36, -28, 1.4, "base"),
      ramp(-2.5, 2.5, -28, -24, 0, 1.4, "z", -1),
      box(-12, -9, -25, -22, 2.3, "crate"),
      box(-12, -9, -22, -19, 1.2, "crate"),
      box(9, 12, -24, -21, 2.3, "crate"),
      box(3, 6, -18, -15, 2.3, "crate"),
      box(-6, -3, -14, -11, 1.1, "crate"),
      // Flank catwalk (east) with its ramp.
      box(15, 20, -26, -6, 2.0),
      ramp(15, 20, -30, -26, 0, 2.0, "z", 1),
      box(-20, -16, -16, -12, 2.3, "crate"),
      box(7, 10, -9, -6, 2.3, "crate"),
      // Canal banks (the canal itself is the ground between them, the banks are raised).
      box(-20, 20, -6, -3, 0.9),
    ]),
    // Bridge over the canal in the middle (a raised block, walk up the banks).
    box(-3, 3, -3, 3, 0.9),
  ],
  spawns: [
    [
      [-3.5, -33],
      [-1.2, -34],
      [1.2, -34],
      [3.5, -33],
    ],
    [
      [3.5, 33],
      [1.2, 34],
      [-1.2, 34],
      [-3.5, 33],
    ],
  ],
};

/**
 * Rooftop Court: a compact stage sized for 2 v 2 (about 45% of Harbor Plaza's floor), so four
 * players meet often. Low base decks, two cover crates per side, a raised flank walkway, and a
 * low hill in the middle with ramps east and west.
 */
const COURT: MapDef = {
  name: "天台球场",
  blurb: "2v2 专用小地图：两端低台、中间小土坡、一侧高走道，碰面快。",
  halfX: 16,
  halfZ: 28,
  res: 4,
  time: "day",
  solids: [
    ...sym([
      // Team 0's deck (z < 0) and its ramps.
      box(-6, 6, -28, -23, 1.4, "base"),
      ramp(-2.5, 2.5, -23, -19, 0, 1.4, "z", -1),
      ramp(6, 9.5, -27, -24, 0, 1.4, "x", -1),
      // Cover in front of the deck.
      box(-9.5, -6.5, -18, -15, 2.2, "crate"),
      box(6, 9, -15, -12, 2.2, "crate"),
      box(-2, 2, -13.5, -12.4, 1.0, "wall"),
      // West flank: a raised walkway with a ramp up from the deck side.
      box(-16, -11.5, -11, -3, 1.6),
      ramp(-16, -11.5, -14.5, -11, 0, 1.6, "z", 1),
      // Mid approach.
      box(4, 7, -7, -4, 2.2, "crate"),
    ]),
    // The hill in the middle: one block, ramps east and west (they mirror onto each other).
    box(-3, 3, -2.5, 2.5, 1.2),
    ramp(3, 6.5, -2, 2, 0, 1.2, "x", -1),
    ramp(-6.5, -3, -2, 2, 0, 1.2, "x", 1),
  ],
  spawns: [
    [
      [-2, -25.5],
      [2, -25.5],
    ],
    [
      [2, 25.5],
      [-2, 25.5],
    ],
  ],
};

/** COURT first: it's the default for 2 v 2. The two bigger stages stay for a roomier game. */
export const MAPS: MapDef[] = [COURT, PLAZA, YARD];
/** The menus' backdrop stage. */
export const BACKDROP_MAP = PLAZA;

export function solidTop(s: Solid, x: number, z: number): number {
  if (!s.ramp) return s.h;
  const { axis, dir, lo } = s.ramp;
  const a = axis === "x" ? x : z;
  const a0 = axis === "x" ? s.x0 : s.z0;
  const a1 = axis === "x" ? s.x1 : s.z1;
  let u = (a - a0) / (a1 - a0);
  if (dir < 0) u = 1 - u;
  return lo + (s.h - lo) * Math.min(1, Math.max(0, u));
}

/** The playable arena: exact heights for physics, a baked grid for paint and bots. */
export class Arena {
  readonly w: number;
  readonly d: number;
  /** Height per grid cell (cell centres). */
  readonly grid: Float32Array;
  /** Paintable cells (1) vs paint-proof (0). */
  readonly paintable: Uint8Array;
  readonly paintableCount: number;

  constructor(readonly def: MapDef) {
    this.w = Math.round(def.halfX * 2 * def.res);
    this.d = Math.round(def.halfZ * 2 * def.res);
    this.grid = new Float32Array(this.w * this.d);
    this.paintable = new Uint8Array(this.w * this.d);
    let n = 0;
    for (let j = 0; j < this.d; j++)
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.cellCentre(i, j);
        let h = 0;
        let paint = true;
        for (const s of def.solids)
          if (x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1) {
            const t = solidTop(s, x, z);
            if (t >= h) {
              h = t;
              paint = !s.noPaint;
            }
          }
        this.grid[j * this.w + i] = h;
        this.paintable[j * this.w + i] = paint ? 1 : 0;
        if (paint) n++;
      }
    this.paintableCount = n;
  }

  cellCentre(i: number, j: number): [number, number] {
    const r = this.def.res;
    return [(i + 0.5) / r - this.def.halfX, (j + 0.5) / r - this.def.halfZ];
  }

  cellOf(x: number, z: number): [number, number] {
    const r = this.def.res;
    return [Math.floor((x + this.def.halfX) * r), Math.floor((z + this.def.halfZ) * r)];
  }

  inside(x: number, z: number): boolean {
    return Math.abs(x) < this.def.halfX && Math.abs(z) < this.def.halfZ;
  }

  /** Exact surface height (ramps are smooth); outside the arena is a wall. */
  height(x: number, z: number): number {
    if (!this.inside(x, z)) return 99;
    let h = 0;
    for (const s of this.def.solids) if (x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1) h = Math.max(h, solidTop(s, x, z));
    return h;
  }

  /** Highest ground within `r` of (x, z) (a body's footprint). */
  heightUnder(x: number, z: number, r: number): number {
    let h = this.height(x, z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      h = Math.max(h, this.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return h;
  }

  gridHeight(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.w || j >= this.d) return 99;
    return this.grid[j * this.w + i];
  }

  /** First solid point along a segment (ink lines, sight lines). Returns the fraction, or 1. */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.2));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const x = ax + (bx - ax) * u;
      const y = ay + (by - ay) * u;
      const z = az + (bz - az) * u;
      if (this.height(x, z) > y) return (k - 1) / n;
    }
    return 1;
  }

  spawn(team: Team, slot: number): [number, number, number] {
    const s = this.def.spawns[team][slot % this.def.spawns[team].length];
    return [s[0], this.height(s[0], s[1]), s[1]];
  }
}
