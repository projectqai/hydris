# Black-box tests

End-to-end security/behaviour tests that drive a **real** hydris node over the
wire — they build the binary, boot an isolated node on a free port, and exercise
it through the public Connect/HTTP API exactly as an external client (or
attacker) would. No internal Go hooks. They run under the standard `bun test`
runner, so a failing assertion fails the suite (non-zero exit) — wired into
`make deeptest` / `make blackbox`.

```sh
cd test/blackbox
bun install
bun test
```

## Vantage points

The policy engine allows loopback (`is.local`) and treats every non-loopback
peer as untrusted. `startServer()` exposes two base URLs:

- `localBaseUrl`  — loopback, **trusted** (used to provision fixtures).
- `remoteBaseUrl` — the first non-loopback IPv4, **untrusted** (the attacker
  vantage), or `null` if the host has none. Tests that need it use
  `test.skip` in that case; set `HYDRIS_REMOTE_IP` to force an address.

## Writing a new suite

Add a `*.test.ts` that boots a node in `beforeAll`, drives it with the
`harness.ts` clients, and asserts with `expect`:

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, worldClient, type Server } from "./harness.ts";

let server: Server;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server?.stop(); });

test("anonymous remote write is denied", async () => {
  await expect(worldClient(server.remoteBaseUrl!).push(/* ... */)).rejects.toThrow();
});
```

`harness.ts` provides: `startServer`, `worldClient`/`artifactClient`,
`drainDownload`, `bcrypt`, `looksLikeBcrypt`, `discoverRemoteIPv4`.
`proto.ts` provides entity/entitlement builders over `@projectqai/proto`.

## Env knobs

- `HYDRIS_BIN`       — use a prebuilt binary instead of `go build`.
- `HYDRIS_REMOTE_IP` — override the untrusted vantage address.
