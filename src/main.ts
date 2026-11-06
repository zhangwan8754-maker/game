/**
 * INK RUSH (2 v 2, phone edition): screens, input, camera, the fixed-step loop, and the glue
 * between the World and the network. Offline (vs bots) is simply a host with no guests: one
 * code path. On a touch screen the on-screen controls (ui/touch.ts) stand in for the keyboard
 * and mouse.
 */
import * as THREE from "three";
import "./style.css";
import { Sfx } from "./audio";
import { BOT_SKILL, type BotSkill, MATCH, NET, PALETTES, TEAM_SIZE, type Team, WEAPONS, WEAPON_ORDER, type WeaponId } from "./config";
import { BotBrain, NavGrid } from "./game/bot";
import { aimDir, type GameEvent, Player, World } from "./game/world";
import { BROKER_PARAM, ClientSession, HostSession, type Msg, randomCode } from "./net/session";
import { Actors } from "./render/actors";
import { escapeHtml, Hud } from "./ui/hud";
import { applyLayout, layout } from "./ui/layout";
import { goFullscreen, isTouchDevice, TouchControls } from "./ui/touch";
import { Arena, BACKDROP_MAP, MAPS } from "./world/map";
import { ArenaView } from "./world/scene";

const touchMode = isTouchDevice();
document.body.classList.toggle("touch", touchMode);
const stage = document.getElementById("stage") as HTMLElement;
applyLayout(stage, touchMode);

// ------------------------------------------------------------------ settings

const store = {
  get(k: string, d: string): string {
    try {
      return localStorage.getItem("inkrush." + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem("inkrush." + k, v);
    } catch {
      /* storage blocked */
    }
  },
};

/** Render quality: phones default to the middle one. */
type Quality = "low" | "mid" | "high";
const QUALITY: Record<Quality, { label: string; ratio: number; shadows: boolean; shadowSize: number }> = {
  low: { label: "流畅", ratio: 1, shadows: false, shadowSize: 1024 },
  mid: { label: "标准", ratio: 1.5, shadows: true, shadowSize: 1024 },
  high: { label: "高清", ratio: 1.75, shadows: true, shadowSize: 2048 },
};
const storedQuality = store.get("quality", "");

const settings = {
  name: store.get("name", "玩家" + Math.floor(1000 + Math.random() * 9000)),
  weapon: (store.get("weapon", "blaster") as WeaponId) in WEAPONS ? (store.get("weapon", "blaster") as WeaponId) : "blaster",
  sens: +store.get("sens", "1") || 1,
  invert: store.get("invert", "0") === "1",
  /** Touch look speed, and aim assist (touch only). */
  tsens: +store.get("tsens", "1") || 1,
  assist: store.get("assist", "1") === "1",
  quality: (storedQuality in QUALITY ? storedQuality : touchMode ? "mid" : "high") as Quality,
};
const saveSettings = () => {
  store.set("name", settings.name);
  store.set("weapon", settings.weapon);
  store.set("sens", String(settings.sens));
  store.set("invert", settings.invert ? "1" : "0");
  store.set("tsens", String(settings.tsens));
  store.set("assist", settings.assist ? "1" : "0");
  store.set("quality", settings.quality);
};

// ------------------------------------------------------------------ renderer

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
// Antialiasing is fixed when the context is made: phones skip it unless they asked for "high".
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touchMode || settings.quality === "high", powerPreference: "high-performance" });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 900);
function resize(): void {
  applyLayout(stage, touchMode);
  renderer.setSize(layout.w, layout.h, false);
  camera.aspect = layout.w / layout.h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 120));
// Typing held the layout still (see applyLayout); catch up once the keyboard is gone.
document.addEventListener("focusout", () => setTimeout(resize, 120));

/** Pixel ratio and shadows for the chosen quality; safe to call any time. */
function applyQuality(): void {
  const q = QUALITY[settings.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.ratio));
  resize();
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    // Shaders are built with or without shadows: rebuild them.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
  }
  for (const v of [arenaView, backdrop]) {
    if (!v) continue;
    const s = v.sun.shadow;
    if (s.mapSize.x !== q.shadowSize) {
      s.mapSize.set(q.shadowSize, q.shadowSize);
      s.map?.dispose();
      s.map = null;
    }
  }
}

const sfx = new Sfx();
const hud = new Hud(ui, touchMode);
hud.show(false);
const touch = new TouchControls(ui);
touch.onTouch = () => sfx.start();
/** The HUD and, on a phone, the on-screen controls. */
function hudShow(on: boolean): void {
  hud.show(on);
  touch.show(on && touchMode);
}

// ------------------------------------------------------------------ input

const keys = new Set<string>();
const mouse = { fire: false, bomb: false, dx: 0, dy: 0 };
let pointerLocked = false;
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.code === "Space" || e.code === "Tab") e.preventDefault();
  keys.add(e.code);
  sfx.start();
  onKey(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  mouse.fire = mouse.bomb = false;
  touch.reset();
});
canvas.addEventListener("mousedown", (e) => {
  sfx.start();
  if (inMatch() && !pointerLocked && !touchMode) canvas.requestPointerLock?.();
  if (e.button === 0) mouse.fire = true;
  if (e.button === 2) mouse.bomb = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.fire = false;
  if (e.button === 2) mouse.bomb = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("mousemove", (e) => {
  if (!pointerLocked) return;
  mouse.dx += e.movementX;
  mouse.dy += e.movementY;
});
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});
// iOS Safari: no pinch-zoom or double-tap zoom over the game.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());

// ------------------------------------------------------------------ match state

type Role = "offline" | "host" | "client";
interface RosterEntry {
  id: number;
  name: string;
  team: Team;
  weapon: WeaponId;
  bot: boolean;
  slot: number;
  peer?: string;
}
interface MatchSetup {
  map: number;
  palette: number;
  seconds: number;
  skill: BotSkill;
}

let role: Role = "offline";
let world: World | null = null;
let arenaView: ArenaView | null = null;
let actors: Actors | null = null;
let nav: NavGrid | null = null;
const brains = new Map<number, BotBrain>();
let host: HostSession | null = null;
let client: ClientSession | null = null;
let myId = 0;
let roster: RosterEntry[] = [];
let setup: MatchSetup = { map: 0, palette: 0, seconds: MATCH.seconds, skill: "fresh" };
let lobbyCode = "";
let lobbyStatus = "";
const peerToId = new Map<string, number>();
let resultsT = 0;
let countdownShown = -1;

const inMatch = () => !!world && (world.state === "countdown" || world.state === "play");
const me = () => world?.players.get(myId);

// Camera orientation (the player's aim follows it).
let camYaw = 0;
let camPitch = -0.12;
const camPos = new THREE.Vector3(0, 20, 30);

function buildWorld(s: MatchSetup, entries: RosterEntry[], authority: boolean): void {
  if (backdrop) scene.remove(backdrop.group);
  if (arenaView) scene.remove(arenaView.group);
  if (actors) scene.remove(actors.group);
  const arena = new Arena(MAPS[s.map]);
  world = new World(arena, authority);
  world.localId = myId;
  const colors = PALETTES[s.palette];
  arenaView = new ArenaView(arena, world.paint, colors);
  arenaView.applyTo(scene);
  applyQuality();
  actors = new Actors(colors);
  scene.add(actors.group);
  hud.setColors(colors);
  document.documentElement.style.setProperty("--a", "#" + colors[0].toString(16).padStart(6, "0"));
  document.documentElement.style.setProperty("--b", "#" + colors[1].toString(16).padStart(6, "0"));
  brains.clear();
  nav = authority ? new NavGrid(arena) : null;
  for (const e of entries) {
    const p = new Player(e.id, e.name, e.team, e.weapon, e.bot, e.slot);
    p.remote = authority && !e.bot && e.id !== myId;
    world.add(p);
    if (e.bot && authority) brains.set(e.id, new BotBrain(p, s.skill, e.id * 31 + s.map));
  }
  world.reset(s.seconds);
  world.state = "countdown";
  world.clock = MATCH.countdown;
  hud.roster(world);
  touch.reset();
  const m = me();
  if (m) {
    camYaw = m.yaw;
    camPitch = -0.12;
    ui.style.setProperty("--me", "#" + colors[m.team].toString(16).padStart(6, "0"));
  }
  countdownShown = -1;
}

/** Host / offline: fill the empty slots with bots, two a side. */
let botRound = 0;
function fillBots(humans: RosterEntry[]): RosterEntry[] {
  botRound++;
  const out = humans.map((h) => ({ ...h }));
  let nextId = 100;
  const names = ["Pip", "Squish", "Dot", "Nib", "Glop", "Wisp", "Fizz", "Ripple", "Mop", "Blip", "Goo", "Swash"];
  let n = 0;
  for (const t of [0, 1] as Team[]) {
    const have = out.filter((e) => e.team === t);
    have.forEach((e, i) => (e.slot = i));
    for (let k = have.length; k < TEAM_SIZE; k++) {
      // A different weapon each match and each seat: bots show off the whole armoury.
      const wpn = WEAPON_ORDER[(k * 3 + t * 5 + n + botRound * 2) % WEAPON_ORDER.length];
      out.push({ id: nextId++, name: names[(n++ * 5 + setup.map * 3 + t) % names.length], team: t, weapon: wpn, bot: true, slot: k });
    }
  }
  return out;
}

// ------------------------------------------------------------------ host

function startHostMatch(): void {
  const humans = roster.filter((r) => !r.bot);
  const full = fillBots(humans);
  setup.palette = Math.floor(Math.random() * PALETTES.length);
  buildWorld(setup, full, true);
  host?.closeDoor();
  host?.broadcast({ t: "start", setup, roster: full });
  enterMatch();
}

function hostMsg(peer: string, m: Msg): void {
  if (m.t === "ping") return host?.send(peer, { t: "pong", at: m.at });
  if (m.t === "hello") {
    if (m.v !== BUILD_ID) {
      host?.send(peer, { t: "refuse", why: "游戏版本不一致：双方都刷新一下页面再试" });
      return;
    }
    const id = Math.max(0, ...roster.map((r) => r.id).filter((i) => i < 100)) + 1;
    const counts = [0, 1].map((t) => roster.filter((r) => r.team === t && !r.bot).length);
    const team: Team = counts[0] <= counts[1] ? 0 : 1;
    roster.push({ id, name: String(m.name ?? "玩家").slice(0, 16), team, weapon: (m.weapon as WeaponId) in WEAPONS ? (m.weapon as WeaponId) : "blaster", bot: false, slot: 0, peer });
    peerToId.set(peer, id);
    host?.send(peer, { t: "welcome", id });
    lobbyChanged();
    sfx.ui();
    return;
  }
  const id = peerToId.get(peer);
  if (id === undefined) return;
  const r = roster.find((e) => e.id === id);
  if (m.t === "loadout" && r && !inMatch()) {
    if ((m.weapon as WeaponId) in WEAPONS) r.weapon = m.weapon as WeaponId;
    lobbyChanged();
  } else if (m.t === "swap" && r && !inMatch()) {
    const other = (1 - r.team) as Team;
    if (roster.filter((e) => e.team === other && !e.bot).length < TEAM_SIZE) r.team = other;
    lobbyChanged();
  } else if (world && inMatch()) {
    const p = world.players.get(id);
    if (!p) return;
    if (m.t === "me") {
      const a = m.p as number[];
      p.from.copy(interpPos(p));
      p.fromYaw = p.yaw;
      p.pos.set(a[0], a[1], a[2]);
      p.vel.set(a[3], a[4], a[5]);
      p.yaw = a[6];
      p.pitch = a[7];
      const f = a[8];
      p.swim = !!(f & 1);
      p.submerged = !!(f & 2);
      p.firing = !!(f & 4);
      p.rolling = !!(f & 8);
      p.onGround = !!(f & 16);
      p.charge = a[9] ?? 0;
      p.ink = a[10] ?? p.ink;
      p.to.copy(p.pos);
      p.toYaw = p.yaw;
      p.lerpT = 0;
    } else if (m.t === "ev" && !p.dead) {
      const e = m.e as GameEvent;
      const v = new THREE.Vector3();
      const o = new THREE.Vector3();
      if (e.k === "shot" && e.id === id) {
        world.spawnShot(p, e.w, o.fromArray(e.o), v.fromArray(e.v), e.s, false);
        world.emit(e);
      } else if (e.k === "bomb" && e.id === id) {
        world.spawnBomb(p, o.fromArray(e.o), v.fromArray(e.v), e.s, false);
        world.emit(e);
      } else if (e.k === "beam" && e.id === id) world.beam(p, o.fromArray(e.a), v.fromArray(e.b), e.full);
      else if (e.k === "special" && e.id === id && p.special >= p.w.special && p.specialT < 0) world.startSpecial(p);
    }
  }
}

function hostLeave(peer: string): void {
  const id = peerToId.get(peer);
  peerToId.delete(peer);
  if (id === undefined) return;
  roster = roster.filter((r) => r.id !== id);
  if (world && inMatch()) {
    // A bot takes over their spot for the rest of the match.
    const p = world.players.get(id);
    if (p) {
      const bot = new Player(p.id, p.name + "（机器人）", p.team, p.weapon, true, p.slot);
      bot.pos.copy(p.pos);
      bot.turf = p.turf;
      bot.kills = p.kills;
      world.players.set(id, bot);
      brains.set(id, new BotBrain(bot, setup.skill, id));
      hud.feedLine(`${escapeHtml(p.name)} 离开了 · 机器人接替`);
    }
  }
  lobbyChanged();
}

let snapAcc = 0;
function hostSnapshot(dt: number): void {
  if (!world || !host) return;
  snapAcc += dt;
  if (snapAcc < 1 / NET.snapHz) return;
  snapAcc = 0;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const P = [...world.players.values()].map((p) => [
    p.id,
    r2(p.pos.x),
    r2(p.pos.y),
    r2(p.pos.z),
    r2(p.yaw),
    r2(p.pitch),
    (p.swim ? 1 : 0) | (p.submerged ? 2 : 0) | (p.dead ? 4 : 0) | (p.firing ? 8 : 0) | (p.onGround ? 16 : 0) | (p.rolling ? 32 : 0),
    Math.round(p.hp),
    Math.round(p.special * 10) / 10,
    Math.round(p.turf),
    p.kills,
    p.deaths,
    r2(p.respawnT),
    r2(p.vel.x),
    r2(p.vel.z),
    Math.round(p.ink),
  ]);
  host.broadcast({ t: "snap", st: world.state, c: r2(world.clock), P, E: world.out.splice(0) });
}

// ------------------------------------------------------------------ client

function clientMsg(m: Msg): void {
  if (m.t === "welcome") {
    myId = m.id as number;
    lobbyStatus = "已进入房间 · 等房主开始";
    renderLobby();
  } else if (m.t === "refuse" || m.t === "busy") {
    showError(m.t === "busy" ? "这个房间正在对战或已满（最多 4 人），过一会儿再试。" : String(m.why));
  } else if (m.t === "lobby") {
    roster = m.roster as RosterEntry[];
    setup = m.setup as MatchSetup;
    if (!inMatch() && current === "lobby") renderLobby();
  } else if (m.t === "start") {
    setup = m.setup as MatchSetup;
    buildWorld(setup, m.roster as RosterEntry[], false);
    enterMatch();
  } else if (m.t === "snap" && world) {
    const st = m.st as World["state"];
    world.clock = m.c as number;
    for (const e of m.E as GameEvent[]) onEvent(e, true);
    for (const a of m.P as number[][]) {
      const p = world.players.get(a[0]);
      if (!p) continue;
      const mine = p.id === myId;
      p.hp = a[7];
      p.special = a[8];
      p.turf = a[9];
      p.kills = a[10];
      p.deaths = a[11];
      p.respawnT = a[12];
      const dead = !!(a[6] & 4);
      if (mine) {
        if (dead && !p.dead) p.dead = true;
        continue;
      }
      p.dead = dead;
      p.from.copy(interpPos(p));
      p.fromYaw = interpYaw(p);
      p.to.set(a[1], a[2], a[3]);
      p.toYaw = a[4];
      p.lerpT = 0;
      p.pos.set(a[1], a[2], a[3]);
      p.yaw = a[4];
      p.pitch = a[5];
      p.swim = !!(a[6] & 1);
      p.submerged = !!(a[6] & 2);
      p.firing = !!(a[6] & 8);
      p.onGround = !!(a[6] & 16);
      p.rolling = !!(a[6] & 32);
      p.vel.set(a[13], 0, a[14]);
      p.ink = a[15];
    }
    if (st !== world.state) {
      world.state = st;
      if (st === "results") showResults();
    }
  }
}

let meAcc = 0;
function clientSend(dt: number): void {
  const p = me();
  if (!client || !p) return;
  meAcc += dt;
  if (meAcc < 1 / NET.inputHz) return;
  meAcc = 0;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const f = (p.swim ? 1 : 0) | (p.submerged ? 2 : 0) | (p.firing ? 4 : 0) | (p.rolling ? 8 : 0) | (p.onGround ? 16 : 0);
  client.send({ t: "me", p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), r2(p.yaw), r2(p.pitch), f, r2(p.charge), Math.round(p.ink)] });
}

// ------------------------------------------------------------------ events → feedback

function onEvent(e: GameEvent, fromNet: boolean): void {
  if (!world) return;
  if (fromNet) world.apply(e);
  // (Host events were applied when emitted; world.fx carries them to the drawing below.)
}

function drawEvents(): void {
  if (!world || !actors) return;
  const m = me();
  const ear = m?.pos ?? camPos;
  const near = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - ear.x, z - ear.z) / 40);
  for (const e of world.fx.splice(0)) {
    actors.fx(e, world);
    if (e.k === "shot") {
      if (e.id === myId) sfx.shot(e.w);
      else sfx.shot(e.w, near(e.o[0], e.o[2]) * 0.6);
    } else if (e.k === "beam") sfx.shot("longshot", e.id === myId ? 1 : near(e.a[0], e.a[2]));
    else if (e.k === "splat" && e.r > 0.6) sfx.splat(near(e.x, e.z) * 0.5);
    else if (e.k === "boom") sfx.boom(near(e.x, e.z));
    else if (e.k === "hit") {
      if (e.by === myId) {
        hud.hitMarker();
        sfx.hit();
      }
      if (e.id === myId) sfx.hurt();
    } else if (e.k === "splatted") {
      const v = world.players.get(e.id);
      const k = world.players.get(e.by);
      hud.feedLine(`${hud.name(k)} 击倒了 ${hud.name(v)}`);
      if (e.id === myId || e.by === myId) sfx.splatted();
    } else if (e.k === "special") {
      const p = world.players.get(e.id);
      if (p) hud.feedLine(`${hud.name(p)} · 大招！`);
    }
  }
}

// ------------------------------------------------------------------ the local player's controls

const _aim = new THREE.Vector3();
function localControls(p: Player): void {
  const fwdX = Math.sin(camYaw);
  const fwdZ = Math.cos(camYaw);
  let ax = 0;
  let ay = 0;
  if (keys.has("KeyW")) ay += 1;
  if (keys.has("KeyS")) ay -= 1;
  if (keys.has("KeyD")) ax -= 1;
  if (keys.has("KeyA")) ax += 1;
  // The touch stick is analog (right is +x on screen, ax is +left).
  ax -= touch.mx;
  ay += touch.my;
  const l = Math.max(1, Math.hypot(ax, ay));
  ax /= l;
  ay /= l;
  const c = p.c;
  c.mx = fwdX * ay + fwdZ * ax;
  c.mz = fwdZ * ay - fwdX * ax;
  const playing = world?.state === "play";
  c.jump = (keys.has("Space") || touch.jump) && playing;
  c.swim = (keys.has("ShiftLeft") || keys.has("ShiftRight") || touch.swim) && !!playing;
  c.fire = (mouse.fire || touch.fire) && !!playing;
  c.bomb = (mouse.bomb || keys.has("KeyE") || touch.bomb) && !!playing;
  c.special = (keys.has("KeyQ") || touch.special) && !!playing;
  if (!playing) c.mx = c.mz = 0;
  // Aim where the crosshair points: from the camera into the world, then from the muzzle to that.
  const dir = aimDir(camYaw, camPitch, _aim);
  const far = camPos.clone().addScaledVector(dir, 60);
  const f = world!.arena.raycast(camPos.x, camPos.y, camPos.z, far.x, far.y, far.z);
  const target = camPos.clone().lerp(far, f);
  const mz = new THREE.Vector3(p.pos.x, p.pos.y + 1.15, p.pos.z);
  const dx = target.x - mz.x;
  const dz = target.z - mz.z;
  c.yaw = Math.atan2(dx, dz);
  c.pitch = Math.atan2(target.y - mz.y, Math.hypot(dx, dz));
}

function updateCamera(dt: number, p: Player | undefined, pos: THREE.Vector3): void {
  const sens = 0.0022 * settings.sens;
  camYaw -= mouse.dx * sens;
  camPitch += (settings.invert ? 1 : -1) * mouse.dy * sens;
  mouse.dx = mouse.dy = 0;
  const [tdx, tdy] = touch.takeLook();
  const tsens = 0.0058 * settings.tsens;
  camYaw -= tdx * tsens;
  camPitch += (settings.invert ? 1 : -1) * tdy * tsens;
  if (touchMode && settings.assist && p) aimAssist(dt, p);
  camPitch = Math.max(-1.1, Math.min(0.85, camPitch));
  if (!world || !p) return;
  const pivot = new THREE.Vector3(pos.x, pos.y + (p.swim ? 0.9 : 1.55), pos.z);
  const back = aimDir(camYaw, camPitch, new THREE.Vector3()).multiplyScalar(-1);
  const right = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw));
  const dist = 4.3;
  const want = pivot.clone().addScaledVector(back, dist).addScaledVector(right, 0.55);
  want.y += 0.35;
  // Keep the camera out of walls.
  const f = world.arena.raycast(pivot.x, pivot.y, pivot.z, want.x, want.y, want.z);
  want.lerpVectors(pivot, want, Math.max(0.15, f * 0.95));
  camPos.lerp(want, Math.min(1, dt * 18));
  camera.position.copy(camPos);
  camera.lookAt(camPos.clone().addScaledVector(aimDir(camYaw, camPitch, new THREE.Vector3()), 10));
}

/**
 * Touch aim assist: while firing, the camera eases toward an enemy that is already near the
 * crosshair (within about 9°), in range and in sight. A thumb can't flick like a mouse; this
 * only finishes an aim the player started. Hidden (submerged) enemies are never tracked.
 */
const _to = new THREE.Vector3();
function aimAssist(dt: number, p: Player): void {
  if (!world || world.state !== "play" || p.dead || !p.c.fire) return;
  let bestErr = 0.16;
  let byaw = 0;
  let bpitch = 0;
  for (const q of world.players.values()) {
    if (q.team === p.team || q.dead || q.submerged) continue;
    const pos = interpPos(q);
    if (Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) > p.w.range + 3) continue;
    _to.set(pos.x - camPos.x, pos.y + 0.8 - camPos.y, pos.z - camPos.z);
    const yaw = Math.atan2(_to.x, _to.z);
    const pitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    const dyaw = Math.atan2(Math.sin(yaw - camYaw), Math.cos(yaw - camYaw));
    const dpitch = pitch - camPitch;
    const err = Math.hypot(dyaw, dpitch);
    if (err >= bestErr) continue;
    if (world.arena.raycast(camPos.x, camPos.y, camPos.z, pos.x, pos.y + 0.8, pos.z) < 0.98) continue;
    bestErr = err;
    byaw = dyaw;
    bpitch = dpitch;
  }
  if (bestErr >= 0.16) return;
  const k = Math.min(1, dt * 3);
  camYaw += byaw * k;
  camPitch += bpitch * k;
}

// ------------------------------------------------------------------ interpolation

function interpPos(p: Player): THREE.Vector3 {
  if (p.id === myId || (role !== "client" && !p.remote)) return p.pos;
  return new THREE.Vector3().lerpVectors(p.from, p.to, Math.min(1, p.lerpT));
}
function interpYaw(p: Player): number {
  if (p.id === myId || (role !== "client" && !p.remote)) return p.yaw;
  let d = p.toYaw - p.fromYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return p.fromYaw + d * Math.min(1, p.lerpT);
}
const prevPos = new Map<number, THREE.Vector3>();

// ------------------------------------------------------------------ the loop

const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let tAll = 0;

function fixedStep(dt: number): void {
  if (!world) return;
  const w = world;
  for (const p of w.players.values()) (prevPos.get(p.id) ?? prevPos.set(p.id, p.pos.clone()).get(p.id)!).copy(p.pos);
  const m = me();
  if (m) localControls(m);
  if (role !== "client") {
    // Host / offline: the clock.
    if (w.state === "countdown") {
      w.clock -= dt;
      if (w.clock <= 0) {
        w.state = "play";
        w.clock = w.seconds;
      }
    } else if (w.state === "play") {
      w.clock -= dt;
      if (w.clock <= 0) {
        w.clock = 0;
        w.state = "results";
        hostSnapshot(1);
        showResults();
      }
    }
    for (const [id, b] of brains) {
      const p = w.players.get(id);
      if (!p) continue;
      if (w.state === "play") b.update(dt, w, nav!);
      else p.c.mx = p.c.mz = 0;
    }
    for (const p of w.players.values()) {
      if (p.remote) {
        p.lerpT += dt * NET.inputHz;
        continue;
      }
      if (w.state !== "play") p.c.fire = p.c.bomb = p.c.special = p.c.jump = false;
      w.move(p, dt);
      w.weapons(p, dt, (e) => w.emit(e));
    }
    w.step(dt);
    hostSnapshot(dt);
    // Offline nobody collects the outgoing events: drop them (they were applied already).
    if (!host) w.out.length = 0;
  } else {
    if (m) {
      w.move(m, dt);
      w.weapons(m, dt, (e) => {
        w.fx.push(e);
        client?.send({ t: "ev", e });
      });
      if (m.dead) m.respawnT -= dt;
    }
    for (const p of w.players.values()) if (p.id !== myId) p.lerpT += dt * NET.snapHz;
    w.step(dt);
    clientSend(dt);
  }
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tAll += dt;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 8) {
    fixedStep(STEP);
    acc -= STEP;
    n++;
  }
  if (n >= 8) acc = 0;
  const alpha = acc / STEP;
  if (world && arenaView && actors) {
    const m = me();
    const renderPos = (p: Player) => {
      const base = interpPos(p);
      const prev = prevPos.get(p.id);
      if (base === p.pos && prev) return prev.clone().lerp(p.pos, alpha);
      return base;
    };
    const mpos = m ? renderPos(m) : new THREE.Vector3();
    updateCamera(dt, m, mpos);
    drawEvents();
    world.paint.flush();
    arenaView.update(tAll);
    actors.update(dt, world, m?.team ?? 0, camPos, tAll, (p) => ({ pos: renderPos(p), yaw: interpYaw(p) }));
    hud.update(dt, world, m, world.state === "play" && world.clock < 60);
    if (m && touch.visible) {
      if (m.dead) touch.swim = false;
      touch.update(m.special / m.w.special, m.swim);
    }
    countdownFeedback();
    const rtt = client ? `延迟 ${Math.round(client.rtt)} ms` : host ? `房主 · 已连接 ${host.conns.size} 人` : "";
    hud.netLine(rtt);
    if (world.state === "results") {
      resultsT += dt;
    }
  } else {
    // Menu backdrop: a slow orbit.
    const a = tAll * 0.05;
    camera.position.set(Math.sin(a) * 50, 26, Math.cos(a) * 50);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function countdownFeedback(): void {
  if (!world) return;
  if (world.state === "countdown") {
    const s = Math.ceil(world.clock);
    if (s !== countdownShown && s > 0) {
      countdownShown = s;
      hud.bannerText(String(s));
      sfx.tick();
    }
  } else if (world.state === "play" && countdownShown > 0) {
    countdownShown = 0;
    hud.bannerText("开始！", "go");
    sfx.whistle();
  }
}

// ------------------------------------------------------------------ screens

type ScreenName = "title" | "menu" | "setup" | "online" | "lobby" | "match" | "results" | "help" | "error";
let current: ScreenName = "title";
const screen = document.createElement("div");
screen.className = "screen";
ui.appendChild(screen);

function show(name: ScreenName, html: string, clear = false): void {
  current = name;
  screen.className = "screen" + (clear ? " clear" : "");
  screen.innerHTML = html;
  screen.classList.remove("off");
}
function hideScreen(): void {
  screen.classList.add("off");
}
const $ = (s: string) => screen.querySelector(s) as HTMLElement;
const on = (s: string, f: () => void) => {
  const e = screen.querySelector(s);
  if (e)
    (e as HTMLElement).onclick = () => {
      sfx.start();
      sfx.ui();
      // Every tap is a user gesture: the moment a phone browser lets us go full screen.
      if (touchMode) goFullscreen();
      f();
    };
};

function onKey(code: string): void {
  if (current === "title") return menu();
  if (current === "results" && resultsT > 2.5 && (code === "Enter" || code === "Space")) afterResults();
  if (code === "Escape" && (current === "help" || current === "setup" || current === "online")) menu();
  if (code === "KeyM") sfx.muted = !sfx.muted;
}

function title(): void {
  show(
    "title",
    `<div><div class="logo"><span>INK</span><span>RUSH</span><small>2 v 2 涂地对战</small></div>
     <div class="press">${touchMode ? "点击屏幕开始" : "按任意键开始"}</div></div>`,
    true,
  );
  screen.onclick = () => {
    sfx.start();
    if (touchMode) goFullscreen();
    menu();
  };
}

function weaponPicker(): string {
  return `<div class="weapons">${WEAPON_ORDER.map((id) => `<div class="weapon ${id === settings.weapon ? "sel" : ""}" data-w="${id}"><b>${WEAPONS[id].name}</b><span>${WEAPONS[id].blurb}</span></div>`).join("")}</div>`;
}
function bindWeapons(after?: () => void): void {
  screen.querySelectorAll<HTMLElement>(".weapon").forEach((el) => {
    el.onclick = () => {
      settings.weapon = el.dataset.w as WeaponId;
      saveSettings();
      screen.querySelectorAll(".weapon").forEach((x) => x.classList.toggle("sel", x === el));
      sfx.ui();
      after?.();
    };
  });
}

function menu(): void {
  screen.onclick = null;
  const sensKey = touchMode ? "tsens" : "sens";
  show(
    "menu",
    `<div class="card">
      <div class="logo menu-logo"><span>INK</span><span>RUSH</span></div>
      <button class="big go" id="online">和朋友联机 <small>2v2 · 建房间 / 输房间码 · 最多 4 人</small></button>
      <button class="big" id="vbots">和机器人练习 <small>2v2 · 单机</small></button>
      <button class="big alt" id="help">怎么玩</button>
      <h2>你的名字</h2>
      <div class="row"><input class="txt" id="name" maxlength="16" value="${escapeHtml(settings.name)}"/></div>
      <h2>武器</h2>
      ${weaponPicker()}
      <h2>${touchMode ? "触屏视角" : "鼠标"}</h2>
      <div class="row"><span class="small">灵敏度</span><input type="range" id="sens" min="0.3" max="2.5" step="0.05" value="${settings[sensKey]}"/> <span class="small" id="sensv">${settings[sensKey].toFixed(2)}×</span>
      <label class="small"><input type="checkbox" id="inv" ${settings.invert ? "checked" : ""}/> 上下反转</label>
      ${touchMode ? `<label class="small"><input type="checkbox" id="assist" ${settings.assist ? "checked" : ""}/> 辅助瞄准</label>` : ""}</div>
      <h2>画质</h2>
      <div class="row" id="quality">${(Object.keys(QUALITY) as Quality[]).map((q) => `<button class="${q === settings.quality ? "sel" : "alt"}" data-q="${q}">${QUALITY[q].label}</button>`).join("")}</div>
      <p class="small">手机发烫或卡顿就选「流畅」。</p>
    </div>`,
  );
  bindWeapons();
  const name = $("#name") as HTMLInputElement;
  name.oninput = () => {
    settings.name = name.value.trim().slice(0, 16) || settings.name;
    saveSettings();
  };
  const sens = $("#sens") as HTMLInputElement;
  sens.oninput = () => {
    settings[sensKey] = +sens.value;
    $("#sensv").textContent = settings[sensKey].toFixed(2) + "×";
    saveSettings();
  };
  ($("#inv") as HTMLInputElement).onchange = (e) => {
    settings.invert = (e.target as HTMLInputElement).checked;
    saveSettings();
  };
  const assist = screen.querySelector("#assist") as HTMLInputElement | null;
  if (assist)
    assist.onchange = () => {
      settings.assist = assist.checked;
      saveSettings();
    };
  screen.querySelectorAll<HTMLButtonElement>("#quality button").forEach((b) => {
    b.onclick = () => {
      settings.quality = b.dataset.q as Quality;
      saveSettings();
      applyQuality();
      sfx.ui();
      screen.querySelectorAll("#quality button").forEach((x) => (x.className = x === b ? "sel" : "alt"));
    };
  });
  on("#vbots", setupScreen);
  on("#online", onlineScreen);
  on("#help", help);
}

const SKILL_NAME: Record<BotSkill, string> = { chill: "休闲", fresh: "普通", fierce: "凶猛", legend: "地狱" };

function setupControls(editable: boolean): string {
  const opt = (id: string, items: [string, string][], cur: string) =>
    `<div class="row" data-group="${id}">${items.map(([v, l]) => `<button class="${v === cur ? "sel" : "alt"}" data-v="${v}" ${editable ? "" : "disabled"}>${l}</button>`).join("")}</div>`;
  return `
    <h2>地图</h2>${opt("map", MAPS.map((m, i) => [String(i), m.name]), String(setup.map))}
    <p class="small">${MAPS[setup.map].blurb}</p>
    <h2>机器人强度</h2>${opt("skill", (Object.keys(BOT_SKILL) as BotSkill[]).map((k) => [k, SKILL_NAME[k]]), setup.skill)}
    <h2>时长</h2>${opt("seconds", [["90", "90 秒"], ["180", "3 分钟"], ["300", "5 分钟"]], String(setup.seconds))}`;
}
function bindSetup(after: () => void): void {
  screen.querySelectorAll<HTMLElement>("[data-group]").forEach((g) => {
    g.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => {
        const k = g.dataset.group!;
        const v = b.dataset.v!;
        if (k === "map") setup.map = +v;
        else if (k === "skill") setup.skill = v as BotSkill;
        else setup.seconds = +v;
        sfx.ui();
        after();
      };
    });
  });
}

function setupScreen(): void {
  show(
    "setup",
    `<div class="card"><h1>和机器人练习</h1><p>你和 1 个机器人一队，对面 2 个机器人。时间到时，涂地面积大的一队获胜。</p>
     ${setupControls(true)}
     <h2>武器</h2>${weaponPicker()}
     <div class="row actions"><button class="go" id="start">开始！</button><button class="alt" id="back">返回</button></div></div>`,
  );
  bindSetup(setupScreen);
  bindWeapons();
  on("#back", menu);
  on("#start", () => {
    role = "offline";
    myId = 0;
    roster = [{ id: 0, name: settings.name, team: 0, weapon: settings.weapon, bot: false, slot: 0 }];
    startHostMatch();
  });
}

function onlineScreen(): void {
  show(
    "online",
    `<div class="card"><h1>和朋友联机</h1><p>2v2，一个房间最多 4 人，空位由机器人补上。房主的手机运行整局游戏，其他人直接连到房主。</p>
     <div class="row"><button class="go" id="create">创建房间</button><button id="quick">快速匹配</button></div>
     <h2>加入朋友的房间</h2>
     <div class="row"><input class="txt code" id="code" maxlength="5" placeholder="房间码" autocapitalize="characters" autocomplete="off"/><button id="join">加入</button></div>
     <p class="small" style="margin-top:16px">最稳的玩法：大家连同一个 Wi-Fi（或者一个人开热点）。不同网络之间（比如 4G 连家里宽带）有时打不通，打不通就换到同一个 Wi-Fi 再试。在微信里打开的话，先点右上角「在浏览器打开」。</p>
     <div class="row"><button class="alt" id="back">返回</button></div></div>`,
  );
  on("#back", menu);
  on("#create", () => hostLobby(randomCode(), false));
  on("#quick", () => quickMatch());
  const code = $("#code") as HTMLInputElement;
  const join = () => {
    const v = code.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (v.length >= 4) joinLobby(v, () => showError("没有这个房间（可能已经关闭）。检查一下房间码。"));
  };
  on("#join", join);
  code.onkeydown = (e) => {
    if (e.key === "Enter") join();
    e.stopPropagation();
  };
}

function quickMatch(): void {
  lobbyStatus = "正在找房间…";
  lobbyCode = "";
  renderLobbyShell();
  // Join the open quick-match lobby, or open one ourselves.
  joinLobby("QUICK", () => hostLobby("QUICK", true, () => setTimeout(quickMatch, 600 + Math.random() * 800)), true);
}

function hostLobby(code: string, quick: boolean, taken?: () => void): void {
  role = "host";
  myId = 0;
  lobbyCode = quick ? "" : code;
  roster = [{ id: 0, name: settings.name, team: 0, weapon: settings.weapon, bot: false, slot: 0 }];
  host?.close();
  host = new HostSession(code, quick);
  host.onReady = () => {
    lobbyStatus = quick ? "快速匹配房间已开 · 其他点「快速匹配」的人会进到这里" : "房间已开好 · 把链接或房间码发给朋友";
    renderLobby();
  };
  host.onJoin = () => undefined;
  host.onMsg = hostMsg;
  host.onLeave = hostLeave;
  host.onError = (w) => showError(w);
  host.start(taken ?? (() => showError("这个房间码被占用了，重新建一个房间。")));
  lobbyStatus = "正在开房间…";
  renderLobby();
}

function joinLobby(code: string, missing: () => void, quick = false): void {
  role = "client";
  client?.close();
  client = new ClientSession(code);
  lobbyCode = quick ? "" : code;
  client.onOpen = () => client!.send({ t: "hello", name: settings.name, weapon: settings.weapon, v: BUILD_ID });
  client.onMsg = clientMsg;
  client.onClose = (why) => showError(`连接断开：${why}。`);
  client.start(() => {
    client = null;
    missing();
  });
  lobbyStatus = "正在连接房主…";
  renderLobbyShell();
}

function lobbyChanged(): void {
  if (role !== "host" || !host) return;
  roster.forEach((r) => {
    if (r.id === 0) {
      r.name = settings.name;
      r.weapon = settings.weapon;
    }
  });
  host.broadcast({ t: "lobby", roster, setup });
  if (current === "lobby") renderLobby();
}

function renderLobbyShell(): void {
  show("lobby", `<div class="card"><h1>联机</h1><div class="status">${escapeHtml(lobbyStatus)}</div><div class="row"><button class="alt" id="leave">离开</button></div></div>`);
  on("#leave", leaveOnline);
}

function renderLobby(): void {
  if (inMatch()) return;
  const isHost = role === "host";
  const link = lobbyCode ? shareLink(lobbyCode) : "";
  const canShare = !!link && typeof navigator.share === "function";
  const team = (t: Team) =>
    `<div class="team t${t}"><h3>${t === 0 ? "A 队" : "B 队"}</h3>${Array.from({ length: TEAM_SIZE }, (_, i) => i)
      .map((i) => {
        const r = roster.filter((e) => e.team === t && !e.bot)[i];
        return r ? `<div class="slot ${r.id === myId ? "me" : ""}"><span>${escapeHtml(r.name)}</span><span>${WEAPONS[r.weapon].name}</span></div>` : `<div class="slot bot"><span>机器人</span><span></span></div>`;
      })
      .join("")}</div>`;
  const humans = roster.filter((r) => !r.bot).length;
  show(
    "lobby",
    `<div class="card wide"><h1>${lobbyCode ? `房间 <span class="code-big">${lobbyCode}</span>` : "快速匹配"}</h1>
      ${link ? `<p>把链接发给朋友（点击复制），或者让他们在「加入」里输入房间码：</p><div class="link" id="link">${link}</div>${canShare ? `<div class="row" style="margin-top:8px"><button class="alt" id="share">分享链接…</button></div>` : ""}` : ""}
      <div class="status">${escapeHtml(lobbyStatus)}</div>
      <div class="teams" style="margin-top:12px">${team(0)}${team(1)}</div>
      <div class="row" style="margin-top:10px"><button class="alt" id="swap">换队</button></div>
      <h2>武器</h2>${weaponPicker()}
      ${setupControls(isHost)}
      <div class="row actions">${isHost ? `<button class="go" id="start">开始（${humans} 人${humans < TEAM_SIZE * 2 ? " + 机器人" : ""}）</button>` : `<span class="small">等房主开始</span>`}<button class="alt" id="leave">离开</button></div></div>`,
  );
  on("#leave", leaveOnline);
  on("#link", () => void copyText(link).then((ok) => ((lobbyStatus = ok ? "链接已复制，发给朋友吧" : "复制失败，长按链接手动复制"), renderLobby())));
  on("#share", () => void navigator.share?.({ title: "INK RUSH 2v2", text: `来打一局涂地！房间码 ${lobbyCode}`, url: link }).catch(() => undefined));
  on("#swap", () => {
    if (isHost) {
      const r = roster.find((e) => e.id === myId)!;
      const other = (1 - r.team) as Team;
      if (roster.filter((e) => e.team === other && !e.bot).length < TEAM_SIZE) r.team = other;
      lobbyChanged();
    } else client?.send({ t: "swap" });
  });
  bindWeapons(() => {
    if (isHost) lobbyChanged();
    else client?.send({ t: "loadout", weapon: settings.weapon });
  });
  if (isHost) {
    bindSetup(lobbyChanged);
    on("#start", startHostMatch);
  }
}

/** Clipboard API where allowed (https), else the old select-and-copy. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    t.remove();
    return ok;
  }
}

function leaveOnline(): void {
  host?.close();
  client?.close();
  host = null;
  client = null;
  role = "offline";
  world = null;
  showBackdrop();
  hudShow(false);
  history.replaceState(null, "", location.pathname);
  menu();
}

function shareLink(code: string): string {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("room", code);
  // A custom broker must travel with the link, or the friend looks for the room elsewhere.
  if (BROKER_PARAM) u.searchParams.set("broker", BROKER_PARAM);
  return u.toString();
}

function showError(msg: string): void {
  world = null;
  showBackdrop();
  hudShow(false);
  document.exitPointerLock?.();
  show("error", `<div class="card"><h1>出了点问题</h1><p>${escapeHtml(msg)}</p><div class="row"><button id="ok">返回</button></div></div>`);
  on("#ok", leaveOnline);
}

function help(): void {
  const controls = touchMode
    ? `<b>左半屏拖动</b><span>移动（手指按哪里，摇杆就出现在哪里）</span>
      <b>右半屏拖动</b><span>转视角 / 瞄准</span>
      <b>开火（按住）</b><span>射击。按住开火时继续拖动，可以边打边瞄。滚筒：按住滚地，点一下甩墨；蓄力狙：按住蓄力，松开发射</span>
      <b>潜游（点一下）</b><span>变成墨水潜进自己的颜色里：游得快、敌人看不见、墨水回得快。再点一下或者开火就会浮出来</span>
      <b>跳</b><span>跳跃（潜游时跳得更高）</span>
      <b>炸弹</b><span>扔墨水炸弹，要耗掉大半罐墨</span>
      <b>大招</b><span>涂地攒满能量后按：跳起来炸开一大圈</span>`
    : `<b>WASD</b><span>移动</span><b>鼠标</b><span>瞄准（先点一下游戏画面锁定鼠标）</span>
      <b>左键</b><span>开火 · 滚筒：按住滚地，点一下甩墨 · 蓄力狙：按住蓄力，松开发射</span>
      <b>Shift</b><span>潜游：在自己的墨里游得快、敌人看不见、墨水回得快</span>
      <b>空格</b><span>跳跃</span><b>右键 / E</b><span>墨水炸弹（耗掉大半罐墨）</span>
      <b>Q</b><span>大招：能量满时跳起来炸开一大圈</span><b>M</b><span>静音</span>`;
  show(
    "help",
    `<div class="card"><h1>怎么玩</h1>
    <p>两队各 2 人。时间到时，地面涂得多的一队获胜。把对手打倒，他会回基地等几秒才能复活。</p>
    <div class="keys-list">${controls}</div>
    <p>踩在敌方的墨上会变慢、掉血。涂地会攒大招能量。墨水用完了就潜进自己的颜色里补。</p>
    <div class="row"><button id="back">返回</button></div></div>`,
  );
  on("#back", menu);
}

function enterMatch(): void {
  hideScreen();
  hudShow(true);
  resultsT = 0;
  document.body.classList.add("playing");
  if (!touchMode) canvas.requestPointerLock?.();
}

function showResults(): void {
  if (!world) return;
  document.body.classList.remove("playing");
  document.exitPointerLock?.();
  resultsT = 0;
  const [a, b] = world.paint.coverage();
  const m = me();
  const myTeam = m?.team ?? 0;
  const win: Team = a >= b ? 0 : 1;
  const tie = Math.abs(a - b) < 0.0005;
  const verdict = tie ? "平局！" : win === myTeam ? "胜利！" : "失败…";
  const rows = [...world.players.values()]
    .sort((x, y) => x.team - y.team || y.turf - x.turf)
    .map((p) => `<tr class="t${p.team} ${p.id === myId ? "me" : ""}"><td>${escapeHtml(p.name)}${p.bot ? " <span class='small'>机器人</span>" : ""}</td><td>${WEAPONS[p.weapon].name}</td><td>${Math.round(p.turf)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
    .join("");
  hudShow(false);
  show(
    "results",
    `<div class="card wide"><div class="verdict" style="color:${tie ? "#444" : `var(--${win === 0 ? "a" : "b"})`}">${verdict}</div>
      <div class="result-bar"><div class="a" id="ra">${(a * 100).toFixed(1)}%</div><div class="b" id="rb">${(b * 100).toFixed(1)}%</div></div>
      <table class="stats"><tr><th>玩家</th><th>武器</th><th>涂地</th><th>击倒</th><th>被击倒</th></tr>${rows}</table>
      <div class="row actions"><button class="go" id="again">${role === "offline" ? "再来一局" : "回到房间"}</button><button class="alt" id="menu">主菜单</button></div></div>`,
  );
  const tot = a + b || 1;
  requestAnimationFrame(() => {
    ($("#ra") as HTMLElement).style.flexBasis = `${(a / tot) * 100}%`;
    ($("#rb") as HTMLElement).style.flexBasis = `${(b / tot) * 100}%`;
  });
  sfx.whistle();
  on("#again", afterResults);
  on("#menu", leaveOnline);
}

function afterResults(): void {
  if (role === "offline") return startHostMatch();
  world = null;
  showBackdrop();
  host?.reopen();
  lobbyStatus = role === "host" ? "回到房间了" : "回到房间了 · 等房主开始";
  if (role === "host") lobbyChanged();
  renderLobby();
}

// ------------------------------------------------------------------ boot

declare const __BUILD__: string;
const BUILD_ID = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

// A backdrop for the menus: the first stage with some ink about.
let backdrop: ArenaView | null = null;
function showBackdrop(): void {
  if (!backdrop) {
    const arena = new Arena(BACKDROP_MAP);
    const w = new World(arena, false);
    backdrop = new ArenaView(arena, w.paint, PALETTES[0]);
    for (let k = 0; k < 90; k++) w.paint.splat((((k * 7919) % 97) / 97 - 0.5) * 44, (((k * 104729) % 89) / 89 - 0.5) * 80, 1 + (k % 4), (k % 2) as Team, k + 1);
    w.paint.flush();
  }
  if (arenaView) scene.remove(arenaView.group);
  if (actors) scene.remove(actors.group);
  backdrop.applyTo(scene);
}
showBackdrop();
applyQuality();

window.__ink = {
  get world() {
    return world;
  },
  get role() {
    return role;
  },
  get myId() {
    return myId;
  },
  keys,
  mouse,
  touch,
  touchMode,
  get cam() {
    return [camYaw, camPitch];
  },
  setCam: (y: number, p: number) => {
    camYaw = y;
    camPitch = p;
  },
  start: () => setupScreen(),
};
declare global {
  interface Window {
    __ink: Record<string, unknown>;
  }
}

const q = new URLSearchParams(location.search);
if (q.get("room")) {
  menu();
  const code = q.get("room")!.toUpperCase();
  joinLobby(code, () => showError("没有这个房间（可能已经关闭，或者房主的游戏版本和你的不一样，双方都刷新一下）。"));
} else title();
requestAnimationFrame(frame);
