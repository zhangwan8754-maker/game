/**
 * Bots (run by the host). A coarse 1 m walk grid with A* for getting around; a small brain that
 * switches between painting (go where the turf isn't ours, inking the way), fighting (an enemy
 * in sight and range: aim with a skill-dependent error, strafe, fire, the odd bomb and the
 * special), and refilling (swim in own ink when the tank runs low).
 */
import { BOT_SKILL, type BotSkill, MOVE } from "../config";
import type { Arena } from "../world/map";
import { hashRng } from "../world/paint";
import type { Player, World } from "./world";

export class NavGrid {
  readonly w: number;
  readonly d: number;
  readonly h: Float32Array;

  constructor(readonly arena: Arena) {
    const def = arena.def;
    this.w = def.halfX * 2;
    this.d = def.halfZ * 2;
    this.h = new Float32Array(this.w * this.d);
    for (let j = 0; j < this.d; j++)
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.centre(i, j);
        // A cell is as high as its highest point (a wall that clips a cell makes it a wall).
        this.h[j * this.w + i] = Math.max(arena.height(x, z), arena.height(x - 0.35, z - 0.35), arena.height(x + 0.35, z + 0.35), arena.height(x - 0.35, z + 0.35), arena.height(x + 0.35, z - 0.35));
      }
  }

  centre(i: number, j: number): [number, number] {
    return [i + 0.5 - this.arena.def.halfX, j + 0.5 - this.arena.def.halfZ];
  }

  cell(x: number, z: number): [number, number] {
    return [Math.max(0, Math.min(this.w - 1, Math.floor(x + this.arena.def.halfX))), Math.max(0, Math.min(this.d - 1, Math.floor(z + this.arena.def.halfZ)))];
  }

  /** Can walk (or drop) from a to b: up by no more than a step, down any amount. */
  private pass(a: number, b: number): boolean {
    return this.h[b] - this.h[a] <= MOVE.stepUp + 0.05;
  }

  path(fx: number, fz: number, tx: number, tz: number, maxNodes = 4000): [number, number][] | null {
    const [si, sj] = this.cell(fx, fz);
    const [ti, tj] = this.cell(tx, tz);
    const W = this.w;
    const start = sj * W + si;
    const goal = tj * W + ti;
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const open: [number, number][] = [[0, start]];
    const hdist = (n: number) => Math.hypot((n % W) - ti, Math.floor(n / W) - tj);
    let seen = 0;
    while (open.length && seen++ < maxNodes) {
      // Binary heap pop.
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === k) break;
          [open[k], open[m]] = [open[m], open[k]];
          k = m;
        }
      }
      const cur = top[1];
      if (cur === goal) {
        const out: [number, number][] = [];
        let n: number | undefined = cur;
        while (n !== undefined && n !== start) {
          out.push(this.centre(n % W, Math.floor(n / W)));
          n = came.get(n);
        }
        return out.reverse();
      }
      const ci = cur % W;
      const cj = Math.floor(cur / W);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= this.d) continue;
          const n = nj * W + ni;
          if (!this.pass(cur, n)) continue;
          // No corner cutting past walls.
          if (di && dj && (!this.pass(cur, cj * W + ni) || !this.pass(cur, nj * W + ci))) continue;
          const cost = (g.get(cur) ?? 0) + (di && dj ? 1.414 : 1);
          if (cost < (g.get(n) ?? Infinity)) {
            g.set(n, cost);
            came.set(n, cur);
            const f = cost + hdist(n);
            open.push([f, n]);
            let k = open.length - 1;
            while (k > 0) {
              const pk = (k - 1) >> 1;
              if (open[pk][0] <= open[k][0]) break;
              [open[k], open[pk]] = [open[pk], open[k]];
              k = pk;
            }
          }
        }
    }
    return null;
  }
}

type Mode = "paint" | "fight" | "refill";

export class BotBrain {
  private path: [number, number][] = [];
  private mode: Mode = "paint";
  private thinkT = 0;
  private target: Player | null = null;
  private seenT = 0;
  private strafe = 1;
  private strafeT = 0;
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private fullFor = 0;
  private readonly R: () => number;

  constructor(
    readonly p: Player,
    public skill: BotSkill,
    seed: number,
  ) {
    this.R = hashRng(seed * 7919 + p.id);
  }

  update(dt: number, world: World, nav: NavGrid): void {
    const p = this.p;
    const c = p.c;
    const S = BOT_SKILL[this.skill];
    c.fire = c.bomb = c.special = c.jump = false;
    if (p.dead) {
      this.path = [];
      c.mx = c.mz = 0;
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = S.think + this.R() * S.think * 0.55;
      this.think(world, nav);
    }
    const w = p.w;
    // Where to go.
    let gx = p.pos.x;
    let gz = p.pos.z;
    while (this.path.length && Math.hypot(this.path[0][0] - p.pos.x, this.path[0][1] - p.pos.z) < 0.7) this.path.shift();
    if (this.path.length) [gx, gz] = this.path[0];
    let mx = gx - p.pos.x;
    let mz = gz - p.pos.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-3) {
      mx /= ml;
      mz /= ml;
    } else mx = mz = 0;
    let yaw = ml > 0.1 ? Math.atan2(mx, mz) : p.yaw;
    let pitch = -0.28;

    const t = this.target;
    if (this.mode === "fight" && t && !t.dead) {
      const dx = t.pos.x - p.pos.x;
      const dz = t.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      // Lead the target a little.
      const lead = w.kind === "charge" ? 0 : d / Math.max(w.speed, 1);
      const ax = dx + t.vel.x * lead;
      const az = dz + t.vel.z * lead;
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = S.strafe + this.R() * S.strafe * 1.8;
        this.strafe = this.R() < 0.5 ? -1 : 1;
        this.aimErrYaw = (this.R() - 0.5) * 2 * S.aim;
        this.aimErrPitch = (this.R() - 0.5) * S.aim;
      }
      yaw = Math.atan2(ax, az) + this.aimErrYaw;
      // Blast weapons aim at the feet (the burst catches a near miss); the rest at the body.
      const aimY = w.blast ? 0.25 : 0.7;
      pitch = Math.atan2(t.pos.y + aimY - (p.pos.y + 1.15), d) + this.aimErrPitch + (w.kind === "auto" ? Math.min(0.12, d * 0.006 * (30 / Math.max(w.speed, 1))) : 0);
      const want = w.kind === "roller" ? 0.8 : w.kind === "charge" ? w.range * 0.6 : w.range * 0.7;
      const fx = dx / (d || 1);
      const fz = dz / (d || 1);
      const push = d > want + 1 ? 1 : d < want - 2 ? -0.7 : 0;
      mx = fx * push + -fz * this.strafe * (w.kind === "charge" ? 0.3 : 0.8);
      mz = fz * push + fx * this.strafe * (w.kind === "charge" ? 0.3 : 0.8);
      this.seenT += dt;
      // Hop now and then to be harder to hit.
      if (S.hop > 0 && p.onGround && this.R() < S.hop * dt) c.jump = true;
      if (this.seenT > S.react) {
        if (w.kind === "charge") {
          // Charge, then let go once aimed and full (or the target is close).
          c.fire = !(p.charge >= 0.98 || (p.charge > 0.5 && d < 8));
        } else if (w.kind === "roller") c.fire = d < 6;
        else c.fire = d < w.range + 2;
        if (d > 7 && d < 14 && p.ink > 75 && this.R() < S.bombs * dt * 0.8) c.bomb = true;
      }
      if (p.special >= w.special && d < 7) c.special = true;
    } else if (this.mode === "refill") {
      const own = world.paint.ownerAt(p.pos.x, p.pos.z) === p.team + 1;
      c.swim = own;
      if (!own && this.path.length === 0) c.fire = p.ink > 10;
    } else {
      // Paint: ink the ground ahead as we go.
      if (w.kind === "auto") c.fire = p.ink > 15;
      else if (w.kind === "roller") c.fire = p.ink > 5;
      else {
        pitch = -0.18;
        c.fire = p.ink > 30 && p.charge < 0.55;
      }
    }
    // Swim to travel over our own ink when not shooting.
    const onOwn = world.paint.ownerAt(p.pos.x, p.pos.z) === p.team + 1;
    if (!c.fire && onOwn && ml > 2) c.swim = true;
    else if (this.mode !== "refill") c.swim = false;
    if (c.fire) c.swim = false;
    // Hold the special a while at most.
    if (p.special >= w.special) {
      this.fullFor += dt;
      if (this.fullFor > S.holdSpecial) c.special = true;
    } else this.fullFor = 0;
    // Stuck: hop.
    const moved = Math.hypot(p.pos.x - this.lastX, p.pos.z - this.lastZ);
    this.lastX = p.pos.x;
    this.lastZ = p.pos.z;
    if (Math.hypot(mx, mz) > 0.3 && moved < dt * 0.6) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) {
        c.jump = true;
        if (this.stuckT > 1.6) {
          this.path = [];
          this.thinkT = 0;
          this.stuckT = 0;
        }
      }
    } else this.stuckT = 0;
    c.mx = mx;
    c.mz = mz;
    c.yaw = yaw;
    c.pitch = pitch;
  }

  private think(world: World, nav: NavGrid): void {
    const p = this.p;
    const a = world.arena;
    const S = BOT_SKILL[this.skill];
    // Fight whoever is closest and in sight (a sharp bot: the weakest one in reach).
    let best: Player | null = null;
    let bd = Infinity;
    for (const q of world.players.values()) {
      if (q.team === p.team || q.dead) continue;
      const d = p.pos.distanceTo(q.pos);
      const range = p.w.range + 5;
      if (d > range || (q.submerged && d > S.sense)) continue;
      const f = a.raycast(p.pos.x, p.pos.y + 1.2, p.pos.z, q.pos.x, q.pos.y + 0.9, q.pos.z);
      if (f < 0.98) continue;
      const score = S.focus ? d * 0.5 + q.hp * 0.12 : d;
      if (score < bd) {
        bd = score;
        best = q;
      }
    }
    if (best) {
      if (this.target !== best) this.seenT = 0;
      this.target = best;
      this.mode = "fight";
      this.path = [];
      return;
    }
    this.target = null;
    if (p.ink < S.refill || (this.mode === "refill" && p.ink < 85)) {
      this.mode = "refill";
      if (world.paint.ownerAt(p.pos.x, p.pos.z) !== p.team + 1) this.goTo(this.find(world, 14, (o) => o === p.team + 1), nav);
      else this.path = [];
      return;
    }
    this.mode = "paint";
    if (this.path.length > 2) return;
    this.goTo(this.find(world, 26, (o) => o !== p.team + 1), nav);
  }

  /** A good cell to head for: matching `want`, nearer is better, the far side a little better. */
  private find(world: World, radius: number, want: (owner: number) => boolean): [number, number] | null {
    const p = this.p;
    const a = world.arena;
    let best: [number, number] | null = null;
    let bs = -Infinity;
    const forward = p.team === 0 ? 1 : -1;
    for (let k = 0; k < 28; k++) {
      const ang = this.R() * Math.PI * 2;
      const r = 3 + this.R() * radius;
      const x = p.pos.x + Math.cos(ang) * r;
      const z = p.pos.z + Math.sin(ang) * r;
      if (!a.inside(x, z)) continue;
      // Ink-proof floor (grates) is no target: it can never be turned.
      const [ci, cj] = a.cellOf(x, z);
      if (!a.paintable[cj * a.w + ci]) continue;
      const o = world.paint.ownerAt(x, z);
      if (!want(o)) continue;
      const s = -r * 0.3 + (o !== 0 ? 3 : 0) + z * forward * 0.08 + this.R() * 2;
      if (s > bs) {
        bs = s;
        best = [x, z];
      }
    }
    return best;
  }

  private goTo(t: [number, number] | null, nav: NavGrid): void {
    if (!t) {
      this.path = [];
      return;
    }
    this.path = nav.path(this.p.pos.x, this.p.pos.z, t[0], t[1]) ?? [];
  }
}
