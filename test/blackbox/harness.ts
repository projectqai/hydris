// harness.ts — reusable black-box test infrastructure for a real hydris node.
//
// It runs the prebuilt ./hydris binary, boots an isolated node on a free
// port, and exposes connect-es clients for the loopback ("trusted") and a
// non-loopback ("remote", i.e. untrusted) vantage point. Suites consume this
// from `bun test` files (see authz.test.ts).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";

import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import { WorldService, ArtifactService } from "./proto.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../..");

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
export interface Server {
  port: number;
  /** Trusted vantage: loopback is treated as `is.local` by the policy engine. */
  localBaseUrl: string;
  /** Untrusted vantage: a non-loopback address, or null if none is available. */
  remoteHost: string | null;
  remoteBaseUrl: string | null;
  logs(): string;
  stop(): Promise<void>;
}

const cleanups: Array<() => void> = [];
function registerCleanup(fn: () => void) {
  cleanups.push(fn);
}
for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) {
  process.on(sig, () => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {}
    }
  });
}

function hydrisBinary(): string {
  if (process.env.HYDRIS_BIN) return process.env.HYDRIS_BIN;
  return join(REPO_ROOT, "hydris");
}

// The node binds the SAME port for TCP (API) and UDP (WebRTC/RTSP). Probe both
// so we don't collide with another service (or another node) on the host.
function tcpFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.listen(port, "0.0.0.0", () => s.close(() => res(true)));
  });
}
function udpFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createSocket("udp4");
    s.once("error", () => res(false));
    s.bind(port, "0.0.0.0", () => s.close(() => res(true)));
  });
}
async function freePort(): Promise<number> {
  // Must be ODD: the node binds PORT for the API/WebRTC mux and PORT+1 for RTP,
  // so an even PORT makes RTSP collide with the mux and the node aborts on boot.
  for (let i = 0; i < 80; i++) {
    const port = (49152 + Math.floor(Math.random() * 15000)) | 1;
    if ((await tcpFree(port)) && (await tcpFree(port + 1)) && (await udpFree(port)) && (await udpFree(port + 1))) {
      return port;
    }
  }
  throw new Error("could not find a free TCP+UDP port pair");
}

/** First non-internal IPv4 address, or an override via HYDRIS_REMOTE_IP. */
export function discoverRemoteIPv4(): string | null {
  if (process.env.HYDRIS_REMOTE_IP) return process.env.HYDRIS_REMOTE_IP;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

export async function startServer(): Promise<Server> {
  const bin = hydrisBinary();
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "hydris-data-"));

  const proc = Bun.spawn([bin, "--world", join(dataDir, "world.yaml"), "--disable-local-serial"], {
    cwd: dataDir,
    env: {
      ...process.env,
      PORT: String(port),
      // Isolate the node's config/identity directory from the developer's real one.
      XDG_CONFIG_HOME: join(dataDir, "config"),
      HOME: join(dataDir, "home"),
      HYDRIS_SERVER: "",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let log = "";
  const scan = (chunk: string) => {
    log += chunk;
  };
  const pump = async (stream: ReadableStream<Uint8Array> | undefined) => {
    if (!stream) return;
    const dec = new TextDecoder();
    for await (const chunk of stream) scan(dec.decode(chunk));
  };
  pump(proc.stdout as unknown as ReadableStream<Uint8Array>);
  pump(proc.stderr as unknown as ReadableStream<Uint8Array>);

  const localBaseUrl = `http://127.0.0.1:${port}`;

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      proc.kill();
      await proc.exited;
    } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  };
  registerCleanup(() => {
    try {
      proc.kill();
    } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Wait for /healthz.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (proc.exitCode !== null) {
      await stop();
      throw new Error(`server exited early (code ${proc.exitCode}):\n${log}`);
    }
    try {
      const r = await fetch(`${localBaseUrl}/healthz`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`server did not become healthy on ${localBaseUrl}\n${log}`);
    }
    await Bun.sleep(150);
  }

  const remoteHost = discoverRemoteIPv4();
  return {
    port,
    localBaseUrl,
    remoteHost,
    remoteBaseUrl: remoteHost ? `http://${remoteHost}:${port}` : null,
    logs: () => log,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
export function transportFor(baseUrl: string) {
  return createConnectTransport({
    baseUrl,
    httpVersion: "1.1",
  });
}

export type World = Client<typeof WorldService>;
export type Artifacts = Client<typeof ArtifactService>;

export function worldClient(baseUrl: string): World {
  return createClient(WorldService, transportFor(baseUrl));
}
export function artifactClient(baseUrl: string): Artifacts {
  return createClient(ArtifactService, transportFor(baseUrl));
}

/** A WorldService client that sets arbitrary request headers (e.g. to probe header spoofing). */
export function worldClientWithHeaders(baseUrl: string, headers: Record<string, string>): World {
  const transport = createConnectTransport({
    baseUrl,
    httpVersion: "1.1",
    interceptors: [
      (next) => (req) => {
        for (const [k, v] of Object.entries(headers)) req.header.set(k, v);
        return next(req);
      },
    ],
  });
  return createClient(WorldService, transport);
}

/** Drain a server-streaming DownloadArtifact into a single buffer. */
export async function drainDownload(stream: AsyncIterable<{ chunk?: Uint8Array }>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const m of stream) if (m.chunk?.length) parts.push(m.chunk);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
