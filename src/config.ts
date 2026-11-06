/** Every tuned number in one place: teams, movement, weapons, the match. */

export type Team = 0 | 1;
export type WeaponId = "blaster" | "roller" | "longshot" | "scatter" | "gatling" | "cannon" | "brush";

/** Ink colour pairs; a match picks one. [team 0, team 1]. */
export const PALETTES: [number, number][] = [
  [0xff7a1a, 0x3a5bff],
  [0xb6f000, 0xd92bd9],
  [0xffd21a, 0x7b3dff],
  [0xff3d7f, 0x13d4c0],
];
export const PALETTE_NAMES = ["橙 / 蓝", "青柠 / 品红", "柠檬黄 / 紫", "玫红 / 青"];

/** 2 v 2: two a side, four in a room; bots fill any empty seat. */
export const TEAM_SIZE = 2;
export const MAX_PLAYERS = TEAM_SIZE * 2;

export const MOVE = {
  walk: 5.6,
  /** In the enemy's ink: slowed, and it stings. */
  enemyInkWalk: 2.4,
  enemyInkDps: 12,
  enemyInkHpFloor: 40,
  swim: 10.5,
  swimAir: 7.5,
  accel: 38,
  airAccel: 14,
  gravity: 26,
  jump: 9.2,
  swimJump: 10.5,
  stepUp: 0.55,
  radius: 0.42,
  height: 1.55,
  /** Walls are climbable while swimming in own ink on them? no: walls aren't paintable. */
};

export const INK = {
  max: 100,
  /** Per second, standing still / walking, swimming in own ink. */
  regenIdle: 12,
  regenSwim: 55,
  regenDelay: 0.35,
};

export const HP = { max: 100, regenDelay: 1.6, regen: 60, respawn: 3.2, spawnShield: 1.2 };

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: "auto" | "roller" | "charge";
  blurb: string;
  /** auto: seconds between shots. */
  rate: number;
  ink: number;
  damage: number;
  speed: number;
  range: number;
  spread: number;
  splat: number;
  /** Special gauge points (painted area) needed. */
  special: number;
  walkWhileFiring: number;
  /** auto: blobs per trigger pull (a shotgun), each with its own spread. */
  pellets?: number;
  /** auto: seconds the trigger must be held before the first shot (a gatling spinning up). */
  windup?: number;
  /** A shot that bursts where it lands, hits, or runs out of range. */
  blast?: { radius: number; near: number; far: number };
  /** roller: stripe width (m), seconds between contact hits (0: every step), the tap's fan. */
  rollWidth?: number;
  rollHitCD?: number;
  flingCount?: number;
  flingDamage?: number;
  /** Size of the flying blob (drawing only). */
  shotSize?: number;
  /** Paints a thin trail of droplets in flight. */
  trail?: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  blaster: {
    id: "blaster",
    name: "速射枪",
    kind: "auto",
    blurb: "连发墨弹，中距离，最好上手。",
    rate: 0.1,
    ink: 1.0,
    damage: 34,
    speed: 30,
    range: 13,
    spread: 0.055,
    splat: 0.85,
    special: 190,
    walkWhileFiring: 0.72,
    trail: true,
  },
  roller: {
    id: "roller",
    name: "滚筒",
    kind: "roller",
    blurb: "按住滚出一大条，碾过敌人；点一下甩墨。",
    rate: 0.55,
    ink: 7,
    damage: 125,
    speed: 20,
    range: 9,
    spread: 0.22,
    splat: 0.9,
    special: 170,
    walkWhileFiring: 0.9,
  },
  longshot: {
    id: "longshot",
    name: "蓄力狙",
    kind: "charge",
    blurb: "按住蓄力打出一长条，蓄满一枪击倒。",
    rate: 0.95,
    ink: 18,
    damage: 100,
    speed: 0,
    range: 30,
    spread: 0,
    splat: 0.55,
    special: 200,
    walkWhileFiring: 0.35,
  },
  scatter: {
    id: "scatter",
    name: "散弹枪",
    kind: "auto",
    blurb: "一枪喷出一把墨弹，近身贴脸最狠，射程短。",
    rate: 0.55,
    ink: 5,
    damage: 20,
    speed: 26,
    range: 7.5,
    spread: 0.16,
    splat: 0.7,
    special: 180,
    walkWhileFiring: 0.8,
    pellets: 6,
    shotSize: 0.75,
  },
  gatling: {
    id: "gatling",
    name: "加特林",
    kind: "auto",
    blurb: "按住先转半秒，然后疯狂连射，射程远，开火时走得慢。",
    rate: 0.05,
    ink: 0.75,
    damage: 14,
    speed: 34,
    range: 17,
    spread: 0.06,
    splat: 0.6,
    special: 210,
    walkWhileFiring: 0.45,
    windup: 0.55,
    shotSize: 0.8,
    trail: true,
  },
  cannon: {
    id: "cannon",
    name: "墨炮",
    kind: "auto",
    blurb: "慢速大墨弹，落地爆炸溅一片；正面打中一发击倒。",
    rate: 0.85,
    ink: 10,
    damage: 125,
    speed: 21,
    range: 11,
    spread: 0.015,
    splat: 1.1,
    special: 180,
    walkWhileFiring: 0.6,
    blast: { radius: 2.6, near: 60, far: 30 },
    shotSize: 1.9,
  },
  brush: {
    id: "brush",
    name: "刷子",
    kind: "roller",
    blurb: "按住刷出一窄条，刷的时候跑得比走路还快；点一下连甩。",
    rate: 0.2,
    ink: 3,
    damage: 40,
    speed: 18,
    range: 6,
    spread: 0.2,
    splat: 0.6,
    special: 160,
    walkWhileFiring: 1.35,
    rollWidth: 1.0,
    rollHitCD: 0.3,
    flingCount: 3,
    flingDamage: 24,
    shotSize: 0.7,
  },
};
export const WEAPON_ORDER: WeaponId[] = ["blaster", "scatter", "gatling", "cannon", "roller", "brush", "longshot"];

export const BOMB = { ink: 65, fuse: 0.7, radius: 3.4, damageNear: 180, damageFar: 40, speed: 13, up: 7 };
export const SPECIAL = { radius: 5.2, damage: 160, rise: 0.55 };

export const MATCH = { seconds: 180, countdown: 3.0, results: 9 };

/**
 * Bot skill: aim error (rad), reaction (s), how often it thinks about bombs; how often it
 * rethinks (s), how long it strafes one way (s), how long it sits on a full special (s), how
 * near it notices a hidden (submerged) enemy (m), the chance per second it hops to dodge, the
 * ink level that sends it to refill, and whether it picks off the weakest enemy in sight.
 */
export const BOT_SKILL = {
  chill: { aim: 0.16, react: 0.55, bombs: 0.15, think: 0.35, strafe: 0.6, holdSpecial: 9, sense: 5, hop: 0, refill: 18, focus: false },
  fresh: { aim: 0.08, react: 0.32, bombs: 0.35, think: 0.35, strafe: 0.6, holdSpecial: 9, sense: 5, hop: 0, refill: 18, focus: false },
  fierce: { aim: 0.035, react: 0.18, bombs: 0.6, think: 0.35, strafe: 0.6, holdSpecial: 9, sense: 5, hop: 0, refill: 18, focus: false },
  /** 地狱: near-perfect aim, quick to react and rethink, dodges, focuses the weakest, specials at once. */
  legend: { aim: 0.012, react: 0.09, bombs: 0.9, think: 0.18, strafe: 0.3, holdSpecial: 2.5, sense: 8, hop: 0.9, refill: 26, focus: true },
} as const;
export type BotSkill = keyof typeof BOT_SKILL;

export const NET = { snapHz: 20, inputHz: 30 };
