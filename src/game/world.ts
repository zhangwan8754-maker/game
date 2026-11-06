/**
 * The match. One World runs on every machine; on the host it has authority (damage, splats,
 * respawns, turf, bots, the clock) and turns everything that happens into events that every
 * machine, the host included, applies the same way. A client's World only moves its own
 * player (so its controls answer at once), draws other players where the host says they are,
 * and flies cosmetic copies of everyone's shots.
 *
 * Paint is only ever changed by applying a splat / stripe event, and a splat is seeded, so all
 * machines hold the same turf.
 */
import * as THREE from "three";
import { BOMB, HP, INK, MATCH, MOVE, SPECIAL, type Team, WEAPONS, type WeaponDef, type WeaponId } from "../config";
import type { Arena } from "../world/map";
import { PaintGrid } from "../world/paint";

export interface Controls {
  /** Desired move direction in world space (length ≤ 1). */
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  swim: boolean;
  fire: boolean;
  bomb: boolean;
  special: boolean;
}

export const NO_CONTROLS: Controls = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, swim: false, fire: false, bomb: false, special: false };

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  /** In blob form (holding swim). `submerged`: blob form in own ink (fast, hidden, refilling). */
  swim = false;
  submerged = false;
  hp = HP.max;
  dead = false;
  respawnT = 0;
  shieldT = 0;
  ink = INK.max;
  inkDelay = 0;
  hpDelay = 0;
  special = 0;
  /** Special in progress (seconds since it started, -1 none). */
  specialT = -1;
  fireCD = 0;
  charge = 0;
  firing = false;
  rolling = false;
  /** Tap (fling) vs hold (roll) for the roller. */
  heldFor = 0;
  turf = 0;
  kills = 0;
  deaths = 0;
  /** Latest controls (a bot's brain or the local player's input). */
  c: Controls = { ...NO_CONTROLS };
  /** Host: last reported state from a remote client. */
  remote = false;
  lastRollX = 0;
  lastRollZ = 0;
  /** Seconds until a roller's next contact hit counts (weapons with rollHitCD). */
  rollHitT = 0;
  /** Interpolation (clients, remote players). */
  readonly from = new THREE.Vector3();
  readonly to = new THREE.Vector3();
  fromYaw = 0;
  toYaw = 0;
  lerpT = 1;

  constructor(
    readonly id: number,
    public name: string,
    public team: Team,
    public weapon: WeaponId,
    readonly bot: boolean,
    public slot: number,
  ) {}

  get w(): WeaponDef {
    return WEAPONS[this.weapon];
  }
}

export interface Shot {
  owner: number;
  team: Team;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  travelled: number;
  range: number;
  damage: number;
  splat: number;
  seed: number;
  /** Cosmetic copy (a client's view): never paints or hurts. */
  ghost: boolean;
  dead: boolean;
  weapon: WeaponId;
}

export interface Bomb {
  owner: number;
  team: Team;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  landed: boolean;
  seed: number;
  ghost: boolean;
  dead: boolean;
}

export type GameEvent =
  | { k: "splat"; x: number; z: number; r: number; t: Team; s: number; by: number }
  | { k: "stripe"; ax: number; az: number; bx: number; bz: number; w: number; t: Team; s: number; by: number }
  | { k: "shot"; id: number; w: WeaponId; o: number[]; v: number[]; s: number }
  | { k: "beam"; id: number; a: number[]; b: number[]; full: boolean }
  | { k: "bomb"; id: number; o: number[]; v: number[]; s: number }
  | { k: "boom"; x: number; y: number; z: number; r: number; t: Team }
  | { k: "hit"; id: number; by: number; dmg: number }
  | { k: "splatted"; id: number; by: number }
  | { k: "respawn"; id: number; x: number; y: number; z: number }
  | { k: "special"; id: number };

export type MatchState = "lobby" | "countdown" | "play" | "results";

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class World {
  readonly paint: PaintGrid;
  readonly players = new Map<number, Player>();
  readonly shots: Shot[] = [];
  readonly bombs: Bomb[] = [];
  /** Events produced this step (host: to broadcast; everyone: to render). */
  readonly out: GameEvent[] = [];
  /** Events to draw (sound, particles) this frame, on every machine. */
  readonly fx: GameEvent[] = [];
  state: MatchState = "lobby";
  /** Seconds left in the match (or in the countdown). */
  clock: number = MATCH.seconds;
  seconds: number = MATCH.seconds;
  private seed = 1;
  localId = -1;

  constructor(
    readonly arena: Arena,
    readonly authority: boolean,
  ) {
    this.paint = new PaintGrid(arena);
  }

  nextSeed(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed ^ ((this.localId + 3) * 2654435761);
  }

  add(p: Player): void {
    this.players.set(p.id, p);
    this.place(p);
  }

  place(p: Player): void {
    const [x, y, z] = this.arena.spawn(p.team, p.slot);
    p.pos.set(x, y, z);
    p.vel.set(0, 0, 0);
    p.yaw = p.team === 0 ? 0 : Math.PI;
    p.from.copy(p.pos);
    p.to.copy(p.pos);
    p.fromYaw = p.toYaw = p.yaw;
    p.pitch = 0;
    p.hp = HP.max;
    p.dead = false;
    p.ink = INK.max;
    p.shieldT = HP.spawnShield;
    p.swim = p.submerged = false;
    p.specialT = -1;
    p.charge = 0;
  }

  /** A fresh match: clean turf, everyone home, scores zeroed. */
  reset(seconds: number): void {
    this.paint.clear();
    this.shots.length = 0;
    this.bombs.length = 0;
    this.seconds = seconds;
    for (const p of this.players.values()) {
      this.place(p);
      p.turf = p.kills = p.deaths = 0;
      p.special = 0;
    }
  }

  // ------------------------------------------------------------------ events

  /** Host: record an event, apply it here, queue it for the clients. */
  emit(e: GameEvent): void {
    this.out.push(e);
    this.apply(e);
  }

  /** Apply an event (from the host, or our own when we are the host). */
  apply(e: GameEvent): void {
    this.fx.push(e);
    switch (e.k) {
      case "splat": {
        const g = this.paint.splat(e.x, e.z, e.r, e.t, e.s);
        this.credit(e.by, g);
        break;
      }
      case "stripe": {
        const g = this.paint.stripe(e.ax, e.az, e.bx, e.bz, e.w, e.t, e.s);
        this.credit(e.by, g);
        break;
      }
      case "shot":
        if (!this.authority && e.id !== this.localId) this.spawnShot(this.players.get(e.id), e.w, _v.fromArray(e.o), _w.fromArray(e.v), e.s, true);
        break;
      case "bomb":
        if (!this.authority && e.id !== this.localId) this.spawnBomb(this.players.get(e.id), _v.fromArray(e.o), _w.fromArray(e.v), e.s, true);
        break;
      case "respawn": {
        const p = this.players.get(e.id);
        if (p) {
          this.place(p);
          p.pos.set(e.x, e.y, e.z);
          p.from.copy(p.pos);
          p.to.copy(p.pos);
        }
        break;
      }
      case "splatted": {
        const p = this.players.get(e.id);
        if (p && !this.authority) {
          p.dead = true;
          p.respawnT = HP.respawn;
        }
        break;
      }
    }
  }

  /** Painting earns turf points and fills the special gauge (clients track their own gauge from snapshots). */
  private credit(by: number, cells: number): void {
    const p = this.players.get(by);
    if (!p || !this.authority) return;
    const pts = cells / (this.arena.def.res * this.arena.def.res);
    p.turf += pts;
    if (p.specialT < 0) p.special = Math.min(p.w.special, p.special + pts);
  }

  // ------------------------------------------------------------------ movement

  /** Move one player (the local one on a client; everyone on the host except remote humans). */
  move(p: Player, dt: number): void {
    const c = p.c;
    const a = this.arena;
    if (p.dead) return;
    const under = this.paint.ownerAt(p.pos.x, p.pos.z);
    const own = under === p.team + 1;
    const enemy = under !== 0 && !own;
    p.swim = c.swim && p.specialT < 0 && !p.firing;
    p.submerged = p.swim && own && p.onGround;
    let speed = MOVE.walk;
    if (p.swim) speed = p.submerged ? MOVE.swim : enemy ? MOVE.enemyInkWalk * 0.8 : MOVE.swimAir;
    else if (enemy) speed = MOVE.enemyInkWalk;
    if (p.firing && !p.swim) speed *= p.w.walkWhileFiring;
    if (p.w.kind === "charge" && p.charge > 0) speed *= 0.5;
    if (p.specialT >= 0) speed *= 0.3;
    const want = _v.set(c.mx, 0, c.mz);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);
    const acc = p.onGround ? MOVE.accel : MOVE.airAccel;
    const k = Math.min(1, acc * dt / Math.max(speed, 1));
    p.vel.x += (want.x - p.vel.x) * k;
    p.vel.z += (want.z - p.vel.z) * k;
    if (c.jump && p.onGround) {
      p.vel.y = p.submerged ? MOVE.swimJump : MOVE.jump;
      p.onGround = false;
    }
    p.vel.y -= MOVE.gravity * dt;
    if (p.specialT >= 0 && p.specialT < SPECIAL.rise) p.vel.y = Math.max(p.vel.y, 6);

    // Horizontal, one axis at a time so walls slide.
    const r = MOVE.radius;
    const nx = p.pos.x + p.vel.x * dt;
    if (a.heightUnder(nx, p.pos.z, r) <= p.pos.y + MOVE.stepUp) p.pos.x = nx;
    else p.vel.x = 0;
    const nz = p.pos.z + p.vel.z * dt;
    if (a.heightUnder(p.pos.x, nz, r) <= p.pos.y + MOVE.stepUp) p.pos.z = nz;
    else p.vel.z = 0;
    // Vertical.
    const ground = a.heightUnder(p.pos.x, p.pos.z, r * 0.6);
    p.pos.y += p.vel.y * dt;
    if (p.pos.y <= ground) {
      // Stepping up small ledges and ramps: snap onto them.
      p.pos.y = ground;
      p.vel.y = 0;
      p.onGround = true;
    } else if (p.onGround && p.pos.y - ground < 0.35 && p.vel.y <= 0) {
      p.pos.y = ground;
      p.vel.y = 0;
    } else p.onGround = false;
    p.yaw = c.yaw;
    p.pitch = c.pitch;
    if (!this.authority && p.specialT >= 0) {
      p.specialT += dt;
      if (p.specialT >= SPECIAL.rise + 0.15 && (p.onGround || p.specialT > 1.6)) p.specialT = -1;
    }

    // Ink tank.
    p.inkDelay -= dt;
    if (p.inkDelay <= 0 && !p.firing) p.ink = Math.min(INK.max, p.ink + (p.submerged ? INK.regenSwim : INK.regenIdle) * dt);
  }

  // ------------------------------------------------------------------ weapons

  /**
   * Fire the player's weapon / bomb / special from its controls. On the host this is real; on a
   * client it is the local player's own shots (drawn at once, sent to the host).
   */
  weapons(p: Player, dt: number, send: (e: GameEvent) => void): void {
    const c = p.c;
    p.fireCD -= dt;
    p.firing = false;
    p.rolling = false;
    if (p.dead || p.swim) {
      p.charge = 0;
      p.heldFor = 0;
      return;
    }
    const w = p.w;
    const aim = aimDir(p.yaw, p.pitch, _v);
    const muzzle = _w.set(p.pos.x + aim.x * 0.5, p.pos.y + 1.15, p.pos.z + aim.z * 0.5);
    if (c.fire) p.heldFor += dt;
    if (w.kind === "auto") {
      // A gatling spins up first: hold the trigger `windup` seconds (the crosshair ring shows it).
      const spinning = !!w.windup && c.fire && p.heldFor < w.windup;
      if (spinning) {
        p.firing = p.ink >= w.ink;
        p.charge = p.heldFor / w.windup!;
      } else if (c.fire && p.fireCD <= 0 && p.ink >= w.ink) {
        p.firing = true;
        p.charge = 0;
        // Carry the part of a step we overshot, so the rate holds on the 60 Hz step
        // (a 0.05 s gatling would otherwise round to every 4th step: 15 shots/s, not 20).
        p.fireCD = w.rate + Math.max(-dt, p.fireCD);
        this.spend(p, w.ink);
        for (let k = 0; k < (w.pellets ?? 1); k++) {
          const s = this.nextSeed();
          const R = splitRng(s);
          const d = aimDir(p.yaw + (R() - 0.5) * 2 * w.spread, p.pitch + (R() - 0.5) * w.spread + 0.035, new THREE.Vector3()).multiplyScalar(w.speed * (w.pellets ? 0.9 + R() * 0.2 : 1));
          const e: GameEvent = { k: "shot", id: p.id, w: p.weapon, o: muzzle.toArray(), v: d.toArray(), s };
          this.spawnShot(p, p.weapon, muzzle, d, s, !this.authority);
          send(e);
        }
      } else if (c.fire) p.firing = p.ink >= w.ink;
      if (!c.fire) p.charge = 0;
    } else if (w.kind === "roller") {
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (c.fire && p.heldFor > 0.22 && p.onGround && p.ink > 0) {
        p.firing = true;
        p.rolling = speed > 0.8;
        if (p.rolling) {
          this.spend(p, w.ink * dt * 1.4);
          p.inkDelay = INK.regenDelay;
        }
      }
      // A tap flings a fan of ink.
      if (!c.fire && p.heldFor > 0 && p.heldFor <= 0.22 && p.fireCD <= 0 && p.ink >= w.ink) {
        p.fireCD = w.rate;
        this.spend(p, w.ink);
        const half = ((w.flingCount ?? 7) - 1) / 2;
        for (let k = -half; k <= half; k++) {
          const s = this.nextSeed();
          const d = aimDir(p.yaw + k * 0.09, p.pitch + 0.16, new THREE.Vector3()).multiplyScalar(w.speed * (0.8 + Math.abs(k) * 0.02));
          const e: GameEvent = { k: "shot", id: p.id, w: p.weapon, o: muzzle.toArray(), v: d.toArray(), s };
          this.spawnShot(p, p.weapon, muzzle, d, s, !this.authority);
          send(e);
        }
      }
    } else if (w.kind === "charge") {
      if (c.fire && p.ink >= w.ink * 0.35) {
        p.firing = true;
        p.charge = Math.min(1, p.charge + dt / w.rate);
      } else if (!c.fire && p.charge > 0.12) {
        const full = p.charge >= 1;
        const cost = w.ink * (0.35 + 0.65 * p.charge);
        this.spend(p, Math.min(p.ink, cost));
        const len = w.range * (0.45 + 0.55 * p.charge);
        const end = muzzle.clone().addScaledVector(aim, len);
        const f = this.arena.raycast(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z);
        end.lerpVectors(muzzle, end, f);
        if (this.authority) this.beam(p, muzzle, end, full);
        else {
          const e: GameEvent = { k: "beam", id: p.id, a: muzzle.toArray(), b: end.toArray(), full };
          this.fx.push(e);
          send(e);
        }
        p.charge = 0;
      } else if (!c.fire) p.charge = 0;
    }
    if (!c.fire) p.heldFor = 0;

    // Bomb.
    if (c.bomb && p.ink >= BOMB.ink && p.fireCD <= 0) {
      p.fireCD = 0.35;
      this.spend(p, BOMB.ink);
      const s = this.nextSeed();
      const v = aimDir(p.yaw, p.pitch, new THREE.Vector3()).multiplyScalar(BOMB.speed);
      v.y += BOMB.up;
      const e: GameEvent = { k: "bomb", id: p.id, o: muzzle.toArray(), v: v.toArray(), s };
      this.spawnBomb(p, muzzle, v, s, !this.authority);
      send(e);
    }
    // Special.
    if (c.special && p.specialT < 0 && p.special >= w.special) {
      if (this.authority) this.startSpecial(p);
      else {
        // Our own leap starts at once; the host bursts it where we land.
        p.special = 0;
        p.specialT = 0;
        p.vel.y = 8;
        p.onGround = false;
        this.fx.push({ k: "special", id: p.id });
        send({ k: "special", id: p.id });
      }
    }
  }

  private spend(p: Player, ink: number): void {
    p.ink = Math.max(0, p.ink - ink);
    p.inkDelay = INK.regenDelay;
  }

  spawnShot(p: Player | undefined, weapon: WeaponId, o: THREE.Vector3, v: THREE.Vector3, seed: number, ghost: boolean): void {
    if (!p) return;
    const w = WEAPONS[weapon];
    this.shots.push({
      owner: p.id,
      team: p.team,
      pos: o.clone(),
      vel: v.clone(),
      travelled: 0,
      range: w.kind === "roller" ? w.range * 0.8 : w.range,
      damage: w.kind === "roller" ? (w.flingDamage ?? 38) : w.damage,
      splat: w.splat,
      seed,
      ghost,
      dead: false,
      weapon,
    });
  }

  spawnBomb(p: Player | undefined, o: THREE.Vector3, v: THREE.Vector3, seed: number, ghost: boolean): void {
    if (!p) return;
    this.bombs.push({ owner: p.id, team: p.team, pos: o.clone(), vel: v.clone(), fuse: BOMB.fuse, landed: false, seed, ghost, dead: false });
  }

  /** Host: a longshot line: paint along it, hurt whoever it passes through. */
  beam(p: Player, a: THREE.Vector3, b: THREE.Vector3, full: boolean): void {
    this.emit({ k: "beam", id: p.id, a: a.toArray(), b: b.toArray(), full });
    // Ink under the line (only where it runs close to the ground) and a splat at the end.
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 1.2));
    let last: [number, number] | null = null;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      const z = a.z + (b.z - a.z) * u;
      const low = y - this.arena.height(x, z) < 2.2;
      if (low && last) this.emit({ k: "stripe", ax: last[0], az: last[1], bx: x, bz: z, w: 0.6, t: p.team, s: this.nextSeed(), by: p.id });
      last = low ? [x, z] : null;
    }
    this.emit({ k: "splat", x: b.x, z: b.z, r: full ? 1.4 : 0.9, t: p.team, s: this.nextSeed(), by: p.id });
    const dmg = full ? p.w.damage : 40;
    for (const q of this.players.values()) {
      if (q.team === p.team || q.dead) continue;
      if (segDist(a, b, _v.set(q.pos.x, q.pos.y + 0.8, q.pos.z)) < (q.submerged ? 0.35 : 0.6)) this.hurt(q, dmg, p.id);
    }
  }

  startSpecial(p: Player): void {
    p.special = 0;
    p.specialT = 0;
    p.vel.y = 8;
    p.onGround = false;
    this.emit({ k: "special", id: p.id });
  }

  // ------------------------------------------------------------------ host rules

  hurt(q: Player, dmg: number, by: number): void {
    if (q.dead || q.shieldT > 0 || !this.authority) return;
    q.hp -= dmg;
    q.hpDelay = HP.regenDelay;
    this.emit({ k: "hit", id: q.id, by, dmg });
    if (q.hp <= 0) {
      q.hp = 0;
      q.dead = true;
      q.respawnT = HP.respawn;
      q.deaths++;
      q.special = Math.floor(q.special * 0.5);
      const killer = this.players.get(by);
      if (killer) killer.kills++;
      this.emit({ k: "splatted", id: q.id, by });
      this.emit({ k: "splat", x: q.pos.x, z: q.pos.z, r: 1.7, t: (1 - q.team) as Team, s: this.nextSeed(), by });
    }
  }

  private explode(x: number, y: number, z: number, r: number, team: Team, by: number, near: number, far: number): void {
    this.emit({ k: "boom", x, y, z, r, t: team });
    this.emit({ k: "splat", x, z, r, t: team, s: this.nextSeed(), by });
    for (const q of this.players.values()) {
      if (q.team === team || q.dead) continue;
      const d = Math.hypot(q.pos.x - x, q.pos.y + 0.8 - y, q.pos.z - z);
      if (d < r * 0.5) this.hurt(q, near, by);
      else if (d < r) this.hurt(q, far, by);
    }
  }

  /** Step the rules (host) and the flying things (everyone). */
  step(dt: number): void {
    // Shots.
    for (const s of this.shots) {
      if (s.dead) continue;
      s.vel.y -= (s.travelled > s.range ? 30 : 7) * dt;
      const step = s.vel.length() * dt;
      s.travelled += step;
      const nx = s.pos.x + s.vel.x * dt;
      const ny = s.pos.y + s.vel.y * dt;
      const nz = s.pos.z + s.vel.z * dt;
      if (!s.ghost) {
        const blast = WEAPONS[s.weapon].blast;
        for (const q of this.players.values()) {
          if (q.team === s.team || q.dead) continue;
          const d = segDist(s.pos, _w.set(nx, ny, nz), _v.set(q.pos.x, q.pos.y + (q.submerged ? 0.2 : 0.8), q.pos.z));
          if (d < (q.submerged ? 0.45 : 0.62)) {
            this.hurt(q, s.damage, s.owner);
            if (blast) this.explode(nx, ny, nz, blast.radius, s.team, s.owner, blast.near, blast.far);
            else this.emit({ k: "splat", x: nx, z: nz, r: s.splat * 0.6, t: s.team, s: s.seed, by: s.owner });
            s.dead = true;
            break;
          }
        }
        if (s.dead) continue;
        // A blast shot that runs out of range bursts in the air.
        if (blast && s.travelled > s.range) {
          this.explode(nx, ny, nz, blast.radius, s.team, s.owner, blast.near, blast.far);
          s.dead = true;
          continue;
        }
      }
      const h = this.arena.height(nx, nz);
      if (ny <= h) {
        // Hit the ground, or a wall (a wall is taller than where the blob is): ink where it lands.
        const wall = h - ny > 0.3;
        if (!s.ghost) {
          const x = wall ? s.pos.x : nx;
          const z = wall ? s.pos.z : nz;
          const blast = WEAPONS[s.weapon].blast;
          if (blast) this.explode(x, Math.max(ny, this.arena.height(x, z)) + 0.2, z, blast.radius, s.team, s.owner, blast.near, blast.far);
          else this.emit({ k: "splat", x, z, r: wall ? s.splat * 0.55 : s.splat, t: s.team, s: s.seed, by: s.owner });
        }
        s.dead = true;
        continue;
      }
      // A trail of droplets on the way (blasters paint a thin path).
      if (!s.ghost && WEAPONS[s.weapon].trail && Math.floor(s.travelled / 3.2) !== Math.floor((s.travelled - step) / 3.2)) {
        const gy = this.arena.height(nx, nz);
        if (ny - gy < 3) this.emit({ k: "splat", x: nx, z: nz, r: 0.35, t: s.team, s: s.seed + 7, by: s.owner });
      }
      s.pos.set(nx, ny, nz);
      if (s.pos.y < -20 || s.travelled > 80) s.dead = true;
    }
    for (let i = this.shots.length - 1; i >= 0; i--) if (this.shots[i].dead) this.shots.splice(i, 1);

    // Bombs.
    for (const b of this.bombs) {
      if (b.dead) continue;
      if (!b.landed) {
        b.vel.y -= MOVE.gravity * dt;
        const nx = b.pos.x + b.vel.x * dt;
        const nz = b.pos.z + b.vel.z * dt;
        const h = this.arena.height(nx, nz);
        if (h > b.pos.y + 0.2) {
          b.vel.x *= -0.35;
          b.vel.z *= -0.35;
        } else {
          b.pos.x = nx;
          b.pos.z = nz;
        }
        b.pos.y += b.vel.y * dt;
        const g = this.arena.height(b.pos.x, b.pos.z);
        if (b.pos.y <= g + 0.2) {
          b.pos.y = g + 0.2;
          b.landed = true;
          b.vel.set(0, 0, 0);
        }
      } else {
        b.fuse -= dt;
        if (b.fuse <= 0) {
          b.dead = true;
          if (!b.ghost) this.explode(b.pos.x, b.pos.y, b.pos.z, BOMB.radius, b.team, b.owner, BOMB.damageNear, BOMB.damageFar);
        }
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) if (this.bombs[i].dead) this.bombs.splice(i, 1);

    if (!this.authority) return;
    for (const p of this.players.values()) {
      if (p.dead) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          this.place(p);
          this.emit({ k: "respawn", id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z });
        }
        continue;
      }
      p.shieldT -= dt;
      p.hpDelay -= dt;
      if (p.hpDelay <= 0) p.hp = Math.min(HP.max, p.hp + HP.regen * dt);
      // Enemy ink stings.
      const under = this.paint.ownerAt(p.pos.x, p.pos.z);
      if (p.onGround && under !== 0 && under !== p.team + 1 && p.hp > MOVE.enemyInkHpFloor) {
        p.hp = Math.max(MOVE.enemyInkHpFloor, p.hp - MOVE.enemyInkDps * dt);
        p.hpDelay = Math.max(p.hpDelay, 0.3);
      }
      // Rollers (and brushes) paint, and flatten, what they roll over.
      p.rollHitT -= dt;
      if (p.rolling && p.onGround) {
        const width = p.w.rollWidth ?? 2.0;
        const fx = Math.sin(p.yaw);
        const fz = Math.cos(p.yaw);
        const x = p.pos.x + fx * 0.9;
        const z = p.pos.z + fz * 0.9;
        if (Math.hypot(x - p.lastRollX, z - p.lastRollZ) > 0.5) {
          this.emit({ k: "stripe", ax: p.lastRollX || x, az: p.lastRollZ || z, bx: x, bz: z, w: width, t: p.team, s: this.nextSeed(), by: p.id });
          p.lastRollX = x;
          p.lastRollZ = z;
        }
        for (const q of this.players.values()) {
          if (q.team === p.team || q.dead || p.rollHitT > 0) continue;
          if (Math.hypot(q.pos.x - x, q.pos.z - z) < 0.25 + width * 0.5 && Math.abs(q.pos.y - p.pos.y) < 1.2) {
            this.hurt(q, p.w.damage, p.id);
            p.rollHitT = p.w.rollHitCD ?? 0;
          }
        }
      } else {
        p.lastRollX = p.pos.x;
        p.lastRollZ = p.pos.z;
      }
      // Special: rise, then burst.
      if (p.specialT >= 0) {
        p.specialT += dt;
        if (p.specialT >= SPECIAL.rise + 0.15 && (p.onGround || p.specialT > 1.6)) {
          p.specialT = -1;
          this.explode(p.pos.x, p.pos.y + 0.5, p.pos.z, SPECIAL.radius, p.team, p.id, SPECIAL.damage, 60);
        }
      }
    }
  }
}

export function aimDir(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c);
}

function segDist(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l = abx * abx + aby * aby + abz * abz;
  let t = l > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

function splitRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
