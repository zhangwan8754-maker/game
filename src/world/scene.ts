/**
 * Draws the arena: every solid merged by kind into a few meshes whose material samples the paint
 * texture on upward faces (ink never shows on walls: walls aren't paintable), a tiled plaza floor,
 * a harbor all round (water, piers, distant blocks of flats), sun and sky.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PaintGrid } from "./paint";
import type { Arena, Solid } from "./map";
import { solidTop } from "./map";

export interface PaintUniforms {
  paintMap: { value: THREE.Texture };
  paintOrigin: { value: THREE.Vector2 };
  paintSize: { value: THREE.Vector2 };
  colorA: { value: THREE.Color };
  colorB: { value: THREE.Color };
  time: { value: number };
}

const NOISE = /* glsl */ `
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1, 0)), u.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), u.x), u.y);
}
`;

/** Patch a standard material so its upward faces show ink (and bare floor shows its tiles). */
export function paintable(mat: THREE.MeshStandardMaterial, U: PaintUniforms, tiles: boolean): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPW;\nvarying vec3 vPN;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vPW;
varying vec3 vPN;
uniform sampler2D paintMap;
uniform vec2 paintOrigin;
uniform vec2 paintSize;
uniform vec3 colorA;
uniform vec3 colorB;
uniform float time;
float inkWet = 0.0;
${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  ${tiles ? `vec2 tq = fract(vPW.xz / 2.0);
  float line = step(tq.x, 0.025) + step(tq.y, 0.025);
  diffuseColor.rgb *= 1.0 - 0.07 * min(line, 1.0) + 0.05 * (pNoise(floor(vPW.xz / 2.0) * 1.7) - 0.5);` : ""}
  if (vPN.y > 0.6) {
    vec2 uv = (vPW.xz - paintOrigin) / paintSize;
    vec2 ink = texture2D(paintMap, uv).rg;
    float n = pNoise(vPW.xz * 3.1) * 0.6 + pNoise(vPW.xz * 9.0) * 0.4;
    float edge = 0.5 + (n - 0.5) * 0.36;
    float a = smoothstep(edge - 0.04, edge + 0.04, ink.r);
    float b = smoothstep(edge - 0.04, edge + 0.04, ink.g);
    float shade = 0.9 + 0.2 * pNoise(vPW.xz * 1.3 + time * 0.05);
    vec3 inkCol = a >= b ? colorA : colorB;
    float w = max(a, b);
    diffuseColor.rgb = mix(diffuseColor.rgb, inkCol * shade, w);
    inkWet = w;
  }
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, inkWet);")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * inkWet * 0.12;",
      );
  };
  mat.customProgramCacheKey = () => "paint" + (tiles ? "T" : "");
  return mat;
}

function boxGeo(s: Solid): THREE.BufferGeometry {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const g = new THREE.BoxGeometry(w, s.h, d);
  g.translate((s.x0 + s.x1) / 2, s.h / 2, (s.z0 + s.z1) / 2);
  return g;
}

/** A ramp: a box whose top vertices sit on the slope. */
function rampGeo(s: Solid): THREE.BufferGeometry {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const g = new THREE.BoxGeometry(w, 1, d, 1, 1, 1);
  g.translate((s.x0 + s.x1) / 2, 0.5, (s.z0 + s.z1) / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    if (p.getY(k) > 0.5) p.setY(k, Math.max(0.02, solidTop(s, p.getX(k), p.getZ(k))));
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const KIND_COLOR: Record<string, number> = {
  block: 0xd8cbb3,
  crate: 0xd08a45,
  base: 0x8fa9b8,
  tower: 0xf0e8da,
  wall: 0x6f8290,
  step: 0xc9b896,
  pillar: 0xa59a8a,
  grate: 0x4d5663,
};

export class ArenaView {
  readonly group = new THREE.Group();
  readonly uniforms: PaintUniforms;
  readonly sun: THREE.DirectionalLight;
  private readonly water: THREE.Mesh;

  constructor(
    readonly arena: Arena,
    paint: PaintGrid,
    colors: [number, number],
  ) {
    const def = arena.def;
    this.uniforms = {
      paintMap: { value: paint.texture },
      paintOrigin: { value: new THREE.Vector2(-def.halfX, -def.halfZ) },
      paintSize: { value: new THREE.Vector2(def.halfX * 2, def.halfZ * 2) },
      colorA: { value: new THREE.Color(colors[0]) },
      colorB: { value: new THREE.Color(colors[1]) },
      time: { value: 0 },
    };
    const dusk = def.time === "dusk";

    // Floor.
    const floorMat = paintable(new THREE.MeshStandardMaterial({ color: dusk ? 0xb8b2a8 : 0xe8e2d4, roughness: 0.85 }), this.uniforms, true);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(def.halfX * 2, def.halfZ * 2).rotateX(-Math.PI / 2), floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Solids, merged per kind.
    const byKind = new Map<string, THREE.BufferGeometry[]>();
    for (const s of def.solids) {
      const g = s.ramp ? rampGeo(s) : boxGeo(s).toNonIndexed();
      const k = s.kind ?? "block";
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(g);
    }
    for (const [k, geos] of byKind) {
      const g = mergeGeometries(geos, false);
      const mat = paintable(
        new THREE.MeshStandardMaterial({ color: KIND_COLOR[k] ?? 0xcccccc, roughness: k === "crate" ? 0.7 : k === "grate" ? 0.35 : 0.6, metalness: k === "grate" ? 0.7 : 0 }),
        this.uniforms,
        false,
      );
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Base pads: a glowing ring in each team's colour.
    for (const t of [0, 1] as const) {
      const [sx, , sz] = arena.spawn(t, 0);
      const y = arena.height(sx, sz) + 0.02;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.6, 4.2, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: colors[t], transparent: true, opacity: 0.75 }),
      );
      ring.position.set(t === 0 ? 0 : 0, y, sz + (t === 0 ? 0.6 : -0.6));
      this.group.add(ring);
    }

    // Edge fence (the arena boundary is an invisible wall; this shows it).
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x5a6570, roughness: 0.5, metalness: 0.4 });
    const post = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6);
    const rail = new THREE.CylinderGeometry(0.04, 0.04, 1, 6).rotateZ(Math.PI / 2);
    const geos: THREE.BufferGeometry[] = [];
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 2.5);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        geos.push(post.clone().translate(x, arena.height(Math.max(-def.halfX + 0.01, Math.min(def.halfX - 0.01, x)), Math.max(-def.halfZ + 0.01, Math.min(def.halfZ - 0.01, z))) + 0.6, z));
      }
      const r = rail.clone();
      r.scale(len, 1, 1);
      r.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      r.translate((x0 + x1) / 2, 1.1, (z0 + z1) / 2);
      geos.push(r);
    };
    const X = def.halfX;
    const Z = def.halfZ;
    edge(-X, -Z, X, -Z);
    edge(X, -Z, X, Z);
    edge(X, Z, -X, Z);
    edge(-X, Z, -X, -Z);
    const fence = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed()), false), fenceMat);
    fence.castShadow = true;
    this.group.add(fence);

    // Harbor: a quay all round, water, and blocks of flats across it.
    const quay = new THREE.Mesh(new THREE.BoxGeometry(X * 2 + 16, 1, Z * 2 + 16), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9 }));
    quay.position.y = -0.52;
    quay.receiveShadow = true;
    this.group.add(quay);
    const waterMat = new THREE.MeshStandardMaterial({ color: dusk ? 0x1d4d6a : 0x2b8fc4, roughness: 0.12, metalness: 0.1 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2), waterMat);
    this.water.position.y = -1.6;
    this.group.add(this.water);
    // Across the water: pastel blocks of flats with window bands, facing the plaza.
    const flats: THREE.BufferGeometry[] = [];
    const R = mulberry(7);
    const pastel = dusk ? [0x8a6f86, 0x9c7a70, 0x6f7898, 0xa08a6a] : [0xf6d1b3, 0xbfe0d6, 0xf3e3a6, 0xd9c7ef, 0xf2b8b8, 0xe8e2d4];
    const col = new THREE.Color();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2 + R() * 0.05;
      const dist = 150 + R() * 90;
      const w = 12 + R() * 16;
      const h = 10 + R() * 30;
      const g = new THREE.BoxGeometry(w, h, 10 + R() * 8).toNonIndexed();
      g.rotateY(-a + Math.PI / 2);
      g.translate(Math.cos(a) * dist, h / 2 - 1.6, Math.sin(a) * dist);
      col.set(pastel[Math.floor(R() * pastel.length)]);
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        // Darker bands every few metres read as rows of windows.
        const y = g.attributes.position.getY(v);
        const band = Math.floor((y + 1.6) / 3) % 2 === 1 ? 0.86 : 1;
        c[v * 3] = col.r * band;
        c[v * 3 + 1] = col.g * band;
        c[v * 3 + 2] = col.b * band;
      }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      flats.push(g);
    }
    const city = new THREE.Mesh(mergeGeometries(flats, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.group.add(city);

    // Light.
    this.sun = new THREE.DirectionalLight(dusk ? 0xffb27a : 0xfff4e0, dusk ? 2.2 : 2.8);
    this.sun.position.set(dusk ? -40 : 30, dusk ? 22 : 60, dusk ? 30 : 20);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -X - 4;
    sc.right = X + 4;
    sc.top = Z + 4;
    sc.bottom = -Z - 4;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.group.add(this.sun, this.sun.target);
    this.group.add(new THREE.HemisphereLight(dusk ? 0x9a88c8 : 0xcfe9ff, dusk ? 0x4a3a40 : 0xb0a68f, dusk ? 1.3 : 1.7));
  }

  applyTo(scene: THREE.Scene): void {
    const dusk = this.arena.def.time === "dusk";
    scene.add(this.group);
    scene.background = new THREE.Color(dusk ? 0xf0a07a : 0x8fd3ff);
    scene.fog = new THREE.Fog(dusk ? 0xe8a488 : 0xbfe6ff, 140, 520);
  }

  setColors(c: [number, number]): void {
    this.uniforms.colorA.value.set(c[0]);
    this.uniforms.colorB.value.set(c[1]);
  }

  update(t: number): void {
    this.uniforms.time.value = t;
    this.water.position.y = -1.6 + Math.sin(t * 0.6) * 0.05;
  }
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
