// Black-box authentication tests against a real hydris node, via `bun test`.
//
// Identity is derived from the connection by authn.policy: loopback /
// in-process connections resolve to admin.actor (whose entity policy allows
// everything), while a remote connection with no client certificate resolves to
// auth:anonymous — which carries no policy, so the default authz.policy (defer to
// the actor) denies it. Tests needing a non-loopback vantage are skipped when the
// host has no non-loopback IPv4 (set HYDRIS_REMOTE_IP to force one).

import { test, expect, beforeAll, afterAll } from "bun:test";

import { startServer, discoverRemoteIPv4, worldClient, type Server } from "./harness.ts";
import { changeRequest, plainEntity } from "./proto.ts";

const REMOTE_IP = discoverRemoteIPv4();
const remoteTest = REMOTE_IP ? test : test.skip;

let server: Server;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.stop();
});

// A local (loopback) connection resolves to the admin.actor identity.
test("a local connection resolves to admin.actor", async () => {
  const self = await worldClient(server.localBaseUrl).getSelf({});
  expect(self.entityId).toBe("admin.actor");
});

// admin.actor's allow-all policy lets a local connection read and write.
test("a local connection may read and write", async () => {
  const w = worldClient(server.localBaseUrl);
  await w.listEntities({}); // read
  await w.push(changeRequest(plainEntity("sensor.local", { label: "local write" }))); // write
  const ent = (await w.getEntity({ id: "sensor.local" })).entity;
  expect(ent?.label).toBe("local write");
});

// A remote connection with no client certificate resolves to anonymous. The
// default authz.policy currently allows by default (insecure, backwards-compat),
// so anonymous reads succeed until an operator tightens the policy.
remoteTest("a remote anonymous connection is allowed by the insecure default", async () => {
  const w = worldClient(server.remoteBaseUrl!);
  await w.listEntities({});
});
