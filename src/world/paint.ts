/**
 * Who owns each cell of the arena's top surfaces. A splat is a seeded blob (a noisy circle and
 * a few droplets), so the same splat event paints the same cells on every machine. The owner
 * grid doubles as a two-channel texture (team 0 in red, team 1 in green); linear filtering plus
 * a noisy threshold in the surface shader turn the cells into smooth wet-looking edges.
 */
import * as THREE from "three";
import type { Team } from "../config";
import type { Arena } from "./map";

export function hashRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PaintGrid {
  /** 0 = bare, 1 = team 0, 2 = team 1. */
  readonly owner: Uint8Array;
  readonly count = [0, 0];
  readonly texture: THREE.DataTexture;
  private readonly tex: Uint8Array;
  dirty = false;

  constructor(readonly arena: Arena) {
    const n = arena.w * arena.d;
    this.owner = new Uint8Array(n);
    this.tex = new Uint8Array(n * 2);
    this.texture = new THREE.DataTexture(this.tex, arena.w, arena.d, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  clear(): void {
    this.owner.fill(0);
    this.tex.fill(0);
    this.count[0] = this.count[1] = 0;
    this.texture.needsUpdate = true;
  }

  ownerAt(x: number, z: number): 0 | 1 | 2 {
    const [i, j] = this.arena.cellOf(x, z);
    if (i < 0 || j < 0 || i >= this.arena.w || j >= this.arena.d) return 0;
    return this.owner[j * this.arena.w + i] as 0 | 1 | 2;
  }

  /** Share of the paintable arena each team holds. */
  coverage(): [number, number] {
    const n = this.arena.paintableCount || 1;
    return [this.count[0] / n, this.count[1] / n];
  }

  private set(idx: number, team: Team): boolean {
    if (!this.arena.paintable[idx]) return false;
    const v = team + 1;
    const o = this.owner[idx];
    if (o === v) return false;
    if (o) this.count[o - 1]--;
    this.owner[idx] = v;
    this.count[team]++;
    this.tex[idx * 2] = team === 0 ? 255 : 0;
    this.tex[idx * 2 + 1] = team === 1 ? 255 : 0;
    this.dirty = true;
    return true;
  }

  /** A noisy disc; returns the cells newly turned to `team` (special gauge, turf points). */
  splat(x: number, z: number, r: number, team: Team, seed: number): number {
    const R = hashRng(seed);
    const a = this.arena;
    const res = a.def.res;
    // A lumpy rim: five harmonics of random phase.
    const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
    const amp = [0.12 + R() * 0.08, 0.06 + R() * 0.05, 0.04];
    let gained = this.disc(x, z, r, team, (ang) => 1 + amp[0] * Math.sin(ang * 3 + ph[0]) + amp[1] * Math.sin(ang * 5 + ph[1]) + amp[2] * Math.sin(ang * 8 + ph[2]));
    // Droplets flung past the rim.
    const drops = Math.round(r * 2.2);
    for (let k = 0; k < drops; k++) {
      const ang = R() * Math.PI * 2;
      const d = r * (0.95 + R() * 0.7);
      const dr = Math.max(0.5 / res, r * (0.1 + R() * 0.16));
      gained += this.disc(x + Math.cos(ang) * d, z + Math.sin(ang) * d, dr, team, () => 1);
    }
    return gained;
  }

  private disc(x: number, z: number, r: number, team: Team, rim: (ang: number) => number): number {
    const a = this.arena;
    const res = a.def.res;
    const [ci, cj] = a.cellOf(x, z);
    const n = Math.ceil(r * 1.3 * res);
    let gained = 0;
    for (let dj = -n; dj <= n; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= a.d) continue;
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        if (i < 0 || i >= a.w) continue;
        const [px, pz] = a.cellCentre(i, j);
        const dx = px - x;
        const dz = pz - z;
        const d = Math.hypot(dx, dz);
        if (d <= r * rim(Math.atan2(dz, dx)) && this.set(j * a.w + i, team)) gained++;
      }
    }
    return gained;
  }

  /** A straight stripe (a roller's path, a longshot's line). */
  stripe(ax: number, az: number, bx: number, bz: number, width: number, team: Team, seed: number): number {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / (width * 0.35)));
    const R = hashRng(seed);
    let g = 0;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      g += this.disc(ax + (bx - ax) * u, az + (bz - az) * u, (width / 2) * (0.9 + R() * 0.2), team, () => 1);
    }
    return g;
  }

  /** Upload the texture at most this often (a full RG upload is cheap at this size). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }
}
