/**
 * What the players, shots, bombs and splashes look like. Fighters are "blots": a round jelly
 * body with a crest in the team's ink, big eyes, a tank on the back that shows the ink left,
 * stubby feet and the weapon in hand. Holding swim they melt into a puddle-blob; submerged in
 * their own ink they're only a ripple (and invisible to the other team unless close).
 */
import * as THREE from "three";
import { type Team, WEAPONS } from "../config";
import type { GameEvent, Player, World } from "../game/world";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function nameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "700 30px 'Fredoka', 'Baloo 2', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const w = Math.min(248, g.measureText(name).width + 28);
  g.fillStyle = "rgba(15,18,32,0.72)";
  g.beginPath();
  g.roundRect(128 - w / 2, 10, w, 44, 22);
  g.fill();
  g.fillStyle = "#" + color.toString(16).padStart(6, "0");
  g.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  return s;
}

class Blot {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly blob: THREE.Mesh;
  private readonly ripple: THREE.Mesh;
  private readonly tankInk: THREE.Mesh;
  private readonly crest: THREE.Mesh;
  private readonly feet: THREE.Mesh[] = [];
  private readonly weapon = new THREE.Group();
  /** A gatling's barrels: they spin while it fires. */
  private spin: THREE.Object3D | null = null;
  private readonly tag: THREE.Sprite | null;
  private readonly inkMat: THREE.MeshStandardMaterial;
  private walk = 0;
  private squash = 1;

  constructor(
    readonly p: Player,
    color: number,
    showTag: boolean,
  ) {
    this.inkMat = new THREE.MeshStandardMaterial({ color, roughness: 0.2, emissive: color, emissiveIntensity: 0.12 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf6efe6, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.4 });
    const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.45, 6, 14), skin);
    bodyM.position.y = 0.72;
    bodyM.castShadow = true;
    this.body.add(bodyM);
    // Crest: a dollop of ink, drooping to the back.
    this.crest = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), this.inkMat);
    this.crest.scale.set(1.05, 0.7, 1.25);
    this.crest.position.set(0, 1.18, -0.08);
    this.crest.castShadow = true;
    this.body.add(this.crest);
    for (const sx of [-1, 1]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), this.inkMat);
      tuft.position.set(sx * 0.32, 1.08, -0.28);
      this.body.add(tuft);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }));
      eye.position.set(sx * 0.16, 0.93, 0.36);
      eye.scale.set(1, 1.25, 0.6);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), dark);
      pupil.position.set(0, 0, 0.07);
      eye.add(pupil);
      this.body.add(eye);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), dark);
      foot.scale.set(1, 0.6, 1.4);
      foot.position.set(sx * 0.2, 0.08, 0.05);
      foot.castShadow = true;
      this.feet.push(foot);
      this.body.add(foot);
    }
    // Tank on the back: glass with the ink level inside.
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.62, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.35, roughness: 0.05 }));
    glass.position.set(0, 0.78, -0.47);
    this.body.add(glass);
    this.tankInk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.6, 14), this.inkMat);
    this.tankInk.geometry.translate(0, 0.3, 0);
    this.tankInk.position.set(0, 0.48, -0.47);
    this.body.add(this.tankInk);
    this.buildWeapon(dark);
    this.body.add(this.weapon);
    this.root.add(this.body);

    this.blob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), this.inkMat);
    this.blob.scale.set(1, 0.42, 1.25);
    this.blob.position.y = 0.2;
    this.blob.castShadow = true;
    // The blob keeps its eyes on top.
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }));
      eye.position.set(sx * 0.17, 0.75, 0.3);
      eye.scale.set(1, 1 / 0.42, 0.8);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark);
      pupil.position.set(0, 0.02, 0.07);
      eye.add(pupil);
      this.blob.add(eye);
    }
    this.root.add(this.blob);
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.55, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    this.ripple.position.y = 0.04;
    this.root.add(this.ripple);
    this.tag = showTag ? nameTag(p.name, color) : null;
    if (this.tag) {
      this.tag.position.y = 2.0;
      this.root.add(this.tag);
    }
  }

  private buildWeapon(dark: THREE.Material): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b93a6, roughness: 0.35, metalness: 0.6 });
    const g = this.weapon;
    g.position.set(0.36, 0.72, 0.3);
    if (this.p.weapon === "blaster") {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.5), dark);
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 10).rotateX(Math.PI / 2), metal);
      n.position.z = 0.38;
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), this.inkMat);
      t.position.set(0, 0.16, -0.05);
      g.add(b, n, t);
    } else if (this.p.weapon === "roller") {
      g.position.set(0, 0.25, 0.75);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.3, 16).rotateZ(Math.PI / 2), this.inkMat);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), metal);
      h.rotation.x = -0.9;
      h.position.set(0, 0.35, -0.3);
      g.add(r, h);
    } else if (this.p.weapon === "brush") {
      // A short handle and a block of inky bristles, held low in front.
      g.position.set(0.2, 0.3, 0.7);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.22), this.inkMat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.26), dark);
      back.position.y = 0.1;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), metal);
      h.rotation.x = -0.9;
      h.position.set(0, 0.36, -0.22);
      g.add(head, back, h);
    } else if (this.p.weapon === "scatter") {
      // A stubby body and two wide barrels side by side.
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.42), dark);
      for (const sx of [-0.06, 0.06]) {
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.3, 10).rotateX(Math.PI / 2), metal);
        n.position.set(sx, 0.02, 0.34);
        g.add(n);
      }
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), this.inkMat);
      t.position.set(0, 0.17, -0.06);
      g.add(b, t);
    } else if (this.p.weapon === "gatling") {
      // A drum and a ring of six barrels that spin while firing.
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 14).rotateX(Math.PI / 2), this.inkMat);
      drum.position.z = -0.05;
      const spin = new THREE.Group();
      spin.position.z = 0.42;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6).rotateX(Math.PI / 2), metal);
        n.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0);
        spin.add(n);
      }
      g.add(drum, spin);
      this.spin = spin;
    } else if (this.p.weapon === "cannon") {
      // A fat tube with a ball of ink in its mouth.
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.75, 14).rotateX(Math.PI / 2), dark);
      tube.position.z = 0.2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 16), metal);
      ring.position.z = 0.56;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), this.inkMat);
      ball.position.z = 0.52;
      g.add(tube, ring, ball);
    } else {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.25, 10).rotateX(Math.PI / 2), dark);
      b.position.z = 0.35;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 10).rotateX(Math.PI / 2), metal);
      s.position.set(0, 0.11, 0.05);
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.inkMat);
      t.position.set(0, 0.02, -0.28);
      g.add(b, s, t);
    }
  }

  setColor(c: number): void {
    this.inkMat.color.set(c);
    this.inkMat.emissive.set(c);
    (this.ripple.material as THREE.MeshBasicMaterial).color.set(c);
  }

  update(dt: number, pos: THREE.Vector3, yaw: number, localTeam: Team, viewer: THREE.Vector3, t: number): void {
    const p = this.p;
    this.root.visible = !p.dead;
    if (p.dead) return;
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const swim = p.swim;
    const hidden = p.submerged && p.team !== localTeam && pos.distanceTo(viewer) > 4.5;
    this.body.visible = !swim;
    this.blob.visible = swim && !p.submerged;
    this.ripple.visible = p.submerged && !hidden;
    if (p.submerged) {
      this.ripple.scale.setScalar(0.8 + Math.min(1.2, speed * 0.12) + Math.sin(t * 9) * 0.08);
    }
    if (hidden) this.root.visible = speed > 7 && Math.sin(t * 20) > 0.6;
    if (this.tag) this.tag.visible = !hidden && !(p.submerged && p.team !== localTeam);
    // Walk bob and squash on landing.
    this.walk += dt * speed * 2.2;
    const bob = p.onGround ? Math.abs(Math.sin(this.walk)) * 0.07 * Math.min(1, speed / 3) : 0;
    this.squash += ((p.onGround ? 1 : 0.9) - this.squash) * Math.min(1, dt * 10);
    this.body.position.y = bob;
    this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));
    this.feet[0].position.z = 0.05 + Math.sin(this.walk) * 0.12 * Math.min(1, speed / 3);
    this.feet[1].position.z = 0.05 - Math.sin(this.walk) * 0.12 * Math.min(1, speed / 3);
    this.tankInk.scale.y = Math.max(0.02, p.ink / 100);
    this.crest.scale.y = 0.7 + Math.sin(t * 3 + p.id) * 0.03;
    this.weapon.rotation.x = -p.pitch * (p.w.kind === "roller" ? 0 : 1);
    if (p.weapon === "roller") this.weapon.children[0].rotation.x += dt * speed * 3;
    if (this.spin) this.spin.rotation.z += dt * (p.firing ? 30 : 2);
    this.blob.scale.set(1 + Math.sin(t * 12) * 0.05, 0.42, 1.25 + Math.min(0.4, speed * 0.04));
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/** Short-lived sprites: splash droplets, beams, rings. */
interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  team: Team;
}

const MAX_SHOTS = 600;
const MAX_PARTS = 1500;

export class Actors {
  readonly group = new THREE.Group();
  private readonly blots = new Map<number, Blot>();
  private readonly shotMesh: THREE.InstancedMesh[];
  private readonly partMesh: THREE.InstancedMesh[];
  private readonly bombMesh: THREE.InstancedMesh;
  private readonly parts: Particle[] = [];
  private readonly beams: { line: THREE.Mesh; life: number }[] = [];
  private readonly rings: { m: THREE.Mesh; life: number; r: number }[] = [];
  private colors: [number, number];
  private readonly teamMats: THREE.MeshStandardMaterial[];

  constructor(colors: [number, number]) {
    this.colors = colors;
    this.teamMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, emissive: c, emissiveIntensity: 0.25 }));
    const sg = new THREE.SphereGeometry(0.16, 10, 8);
    this.shotMesh = this.teamMats.map((m) => new THREE.InstancedMesh(sg, m, MAX_SHOTS));
    const pg = new THREE.SphereGeometry(0.08, 6, 5);
    this.partMesh = this.teamMats.map((m) => new THREE.InstancedMesh(pg, m, MAX_PARTS));
    this.bombMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.3, metalness: 0.4 }), 64);
    for (const m of [...this.shotMesh, ...this.partMesh, this.bombMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  setColors(c: [number, number]): void {
    this.colors = c;
    this.teamMats.forEach((m, i) => {
      m.color.set(c[i]);
      m.emissive.set(c[i]);
    });
    for (const b of this.blots.values()) b.setColor(c[b.p.team]);
  }

  /** Keep one blot per player (names shown for everyone but ourselves). */
  sync(world: World): void {
    for (const [id, b] of this.blots)
      if (!world.players.has(id) || world.players.get(id) !== b.p) {
        b.dispose();
        this.blots.delete(id);
      }
    for (const p of world.players.values())
      if (!this.blots.has(p.id)) {
        const b = new Blot(p, this.colors[p.team], p.id !== world.localId);
        this.blots.set(p.id, b);
        this.group.add(b.root);
      }
  }

  fx(e: GameEvent, world: World): void {
    if (e.k === "splat" && e.r > 0.5) this.burst(e.x, world.arena.height(e.x, e.z) + 0.1, e.z, e.t, Math.round(e.r * 5), 3);
    else if (e.k === "boom") {
      this.burst(e.x, e.y, e.z, e.t, 60, 9);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: this.colors[e.t], transparent: true, opacity: 0.55 }));
      m.position.set(e.x, e.y, e.z);
      this.group.add(m);
      this.rings.push({ m, life: 0.35, r: e.r });
    } else if (e.k === "beam") {
      const a = new THREE.Vector3().fromArray(e.a);
      const b = new THREE.Vector3().fromArray(e.b);
      const p = world.players.get(e.id);
      const len = a.distanceTo(b);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(e.full ? 0.07 : 0.04, e.full ? 0.07 : 0.04, len, 6).rotateX(Math.PI / 2), this.teamMats[p?.team ?? 0]);
      line.position.lerpVectors(a, b, 0.5);
      line.lookAt(b);
      this.group.add(line);
      this.beams.push({ line, life: 0.18 });
      this.burst(b.x, b.y, b.z, p?.team ?? 0, 14, 4);
    } else if (e.k === "splatted") {
      const p = world.players.get(e.id);
      if (p) this.burst(p.pos.x, p.pos.y + 0.8, p.pos.z, (1 - p.team) as Team, 50, 7);
    }
  }

  private burst(x: number, y: number, z: number, team: Team, n: number, speed: number): void {
    for (let k = 0; k < n && this.parts.length < MAX_PARTS; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      const s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(Math.cos(a) * s * 0.6, up * s * 0.6, Math.sin(a) * s * 0.6),
        life: 0,
        max: 0.35 + Math.random() * 0.4,
        size: 0.6 + Math.random() * 1.4,
        team,
      });
    }
  }

  update(dt: number, world: World, localTeam: Team, viewer: THREE.Vector3, t: number, interp: (p: Player) => { pos: THREE.Vector3; yaw: number }): void {
    this.sync(world);
    for (const b of this.blots.values()) {
      const r = interp(b.p);
      b.update(dt, r.pos, r.yaw, localTeam, viewer, t);
    }
    // Shots.
    const counts = [0, 0];
    for (const s of world.shots) {
      const m = this.shotMesh[s.team];
      const i = counts[s.team]++;
      if (i >= MAX_SHOTS) continue;
      const sp = s.vel.length();
      _q.setFromUnitVectors(UP, _p.copy(s.vel).divideScalar(sp || 1));
      const size = WEAPONS[s.weapon].shotSize ?? 1;
      _s.set(size, size * (1 + Math.min(1.6, sp * 0.04)), size);
      _m.compose(s.pos, _q, _s);
      m.setMatrixAt(i, _m);
    }
    this.shotMesh.forEach((m, k) => {
      m.count = Math.min(MAX_SHOTS, counts[k]);
      m.instanceMatrix.needsUpdate = true;
    });
    this.bombMesh.count = Math.min(64, world.bombs.length);
    world.bombs.forEach((b, i) => {
      if (i >= 64) return;
      const pulse = b.landed ? 1 + Math.sin((1 - b.fuse) * 40) * 0.12 : 1;
      _m.compose(b.pos, _q.identity(), _s.setScalar(pulse));
      this.bombMesh.setMatrixAt(i, _m);
    });
    this.bombMesh.instanceMatrix.needsUpdate = true;
    // Particles.
    const pc = [0, 0];
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life += dt;
      if (q.life >= q.max) {
        this.parts.splice(i, 1);
        continue;
      }
      q.vel.y -= 18 * dt;
      q.pos.addScaledVector(q.vel, dt);
      const k = pc[q.team]++;
      const sc = q.size * (1 - q.life / q.max);
      _m.compose(q.pos, _q.identity(), _s.setScalar(sc));
      this.partMesh[q.team].setMatrixAt(k, _m);
    }
    this.partMesh.forEach((m, k) => {
      m.count = pc[k];
      m.instanceMatrix.needsUpdate = true;
    });
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      b.line.scale.x = b.line.scale.y = Math.max(0.05, b.life / 0.18);
      if (b.life <= 0) {
        b.line.geometry.dispose();
        b.line.removeFromParent();
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const u = 1 - r.life / 0.35;
      r.m.scale.setScalar(r.r * (0.3 + u * 0.8));
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - u);
      if (r.life <= 0) {
        r.m.removeFromParent();
        this.rings.splice(i, 1);
      }
    }
  }
}
