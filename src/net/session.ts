/**
 * Online play: one host, up to seven guests, all over WebRTC (PeerJS for the introductions: the
 * host takes a peer id made of the build and the room code, guests connect to it). The host's
 * browser runs the match (see World); guests send their own movement and shots and draw what
 * the host sends back. No server of our own is involved.
 *
 * Quick match: the first player to find the shared quick-match id free becomes that lobby's
 * host; the next ones join it until the host starts, which frees the id for a new lobby.
 */
import Peer, { type DataConnection } from "peerjs";

export type Msg = { t: string; [k: string]: unknown };

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
const OPTS = { config: { iceServers: ICE }, debug: 0 };

declare const __BUILD__: string;
export const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
const idFor = (room: string) => `ink-rush-${BUILD}-${room}`.replace(/[^A-Za-z0-9-]/g, "");

export class HostSession {
  private peer: Peer | null = null;
  readonly conns = new Map<string, DataConnection>();
  onJoin: ((peerId: string) => void) | null = null;
  onLeave: ((peerId: string) => void) | null = null;
  onMsg: ((peerId: string, m: Msg) => void) | null = null;
  onReady: (() => void) | null = null;
  onError: ((why: string) => void) | null = null;
  /** Taking new players (the lobby); a running match turns newcomers away. */
  open = true;
  /** Last time each guest was heard from: a closed tab never says goodbye, so silence counts. */
  private readonly seen = new Map<string, number>();
  private watch = 0;

  constructor(
    readonly room: string,
    readonly quick: boolean,
  ) {}

  start(taken: () => void): void {
    const p = new Peer(idFor(this.room), OPTS);
    this.peer = p;
    p.on("open", () => this.onReady?.());
    p.on("connection", (c) => {
      if (!this.open || this.conns.size >= 7) {
        c.on("open", () => {
          c.send(JSON.stringify({ t: "busy" }));
          setTimeout(() => c.close(), 300);
        });
        return;
      }
      c.on("open", () => {
        this.conns.set(c.peer, c);
        this.seen.set(c.peer, performance.now());
        this.onJoin?.(c.peer);
      });
      c.on("data", (d) => {
        this.seen.set(c.peer, performance.now());
        if (typeof d !== "string") return;
        try {
          this.onMsg?.(c.peer, JSON.parse(d) as Msg);
        } catch {
          /* not ours */
        }
      });
      const gone = () => {
        this.seen.delete(c.peer);
        if (this.conns.delete(c.peer)) this.onLeave?.(c.peer);
      };
      c.on("close", gone);
      c.on("error", gone);
    });
    p.on("error", (e: { type?: string }) => {
      if (e.type === "unavailable-id") taken();
      else if (e.type !== "peer-unavailable") this.onError?.(`matchmaking broker: ${e.type ?? "error"}`);
    });
    this.watch = window.setInterval(() => {
      const now = performance.now();
      for (const [id, t] of this.seen)
        if (now - t > 6000) {
          this.seen.delete(id);
          this.conns.get(id)?.close();
          if (this.conns.delete(id)) this.onLeave?.(id);
        }
    }, 1000);
    p.on("disconnected", () => {
      // Lost the broker: running connections stay; reconnect so friends can still join the lobby.
      if (this.open && !p.destroyed) p.reconnect();
    });
  }

  /** A match started from a quick-match lobby: free the shared id for the next lobby. */
  closeDoor(): void {
    this.open = false;
    if (this.quick) this.peer?.disconnect();
  }

  reopen(): void {
    this.open = true;
    if (this.quick && this.peer?.disconnected) this.peer.reconnect();
  }

  send(peerId: string, m: Msg): void {
    const c = this.conns.get(peerId);
    if (c?.open) void c.send(JSON.stringify(m));
  }

  broadcast(m: Msg): void {
    const s = JSON.stringify(m);
    for (const c of this.conns.values()) if (c.open) void c.send(s);
  }

  close(): void {
    clearInterval(this.watch);
    this.peer?.destroy();
  }
}

export class ClientSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  onOpen: (() => void) | null = null;
  onMsg: ((m: Msg) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  rtt = 0;
  private pingT = 0;
  private heard = 0;
  private closed = false;

  constructor(readonly room: string) {}

  /** `missing` runs when nobody holds the room id (the room is gone, or quick match: be the host). */
  start(missing: () => void): void {
    const p = new Peer(OPTS);
    this.peer = p;
    p.on("open", () => {
      const c = p.connect(idFor(this.room), { reliable: true, serialization: "raw" });
      this.conn = c;
      c.on("open", () => {
        this.onOpen?.();
        this.heard = performance.now();
        this.pingT = window.setInterval(() => {
          this.send({ t: "ping", at: performance.now() });
          // The host answers every ping: silence means its tab is gone.
          if (performance.now() - this.heard > 8000) this.fail("the host went silent");
        }, 1000);
      });
      c.on("data", (d) => {
        this.heard = performance.now();
        if (typeof d !== "string") return;
        let m: Msg;
        try {
          m = JSON.parse(d) as Msg;
        } catch {
          return;
        }
        if (m.t === "pong") this.rtt = performance.now() - (m.at as number);
        else this.onMsg?.(m);
      });
      c.on("close", () => this.fail("the host left"));
      c.on("error", () => this.fail("the link to the host broke"));
      setTimeout(() => {
        if (!c.open && !this.closed) this.fail("couldn't open a direct link to the host's network");
      }, 20000);
    });
    p.on("error", (e: { type?: string }) => {
      if (e.type === "peer-unavailable") {
        if (!this.closed) {
          this.closed = true;
          p.destroy();
          missing();
        }
      } else this.fail(`matchmaking broker: ${e.type ?? "error"}`);
    });
  }

  private fail(why: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingT);
    this.onClose?.(why);
    this.peer?.destroy();
  }

  send(m: Msg): void {
    if (this.conn?.open) void this.conn.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    clearInterval(this.pingT);
    this.peer?.destroy();
  }
}

export function randomCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(5));
  return [...r].map((b) => A[b % A.length]).join("");
}
