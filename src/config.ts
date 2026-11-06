/** Every tuned number in one place: teams, movement, weapons, the match. */

export type Team = 0 | 1;
export type WeaponId = "blaster" | "roller" | "longshot";

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
};
export const WEAPON_ORDER: WeaponId[] = ["blaster", "roller", "longshot"];

export const BOMB = { ink: 65, fuse: 0.7, radius: 3.4, damageNear: 180, damageFar: 40, speed: 13, up: 7 };
export const SPECIAL = { radius: 5.2, damage: 160, rise: 0.55 };

export const MATCH = { seconds: 180, countdown: 3.0, results: 9 };

/** Bot skill: aim error (rad), reaction (s), how often it thinks about bombs. */
export const BOT_SKILL = {
  chill: { aim: 0.16, react: 0.55, bombs: 0.15 },
  fresh: { aim: 0.08, react: 0.32, bombs: 0.35 },
  fierce: { aim: 0.035, react: 0.18, bombs: 0.6 },
} as const;
export type BotSkill = keyof typeof BOT_SKILL;

export const NET = { snapHz: 20, inputHz: 30 };
