Hydris
======

Like Home Assistant, but for the outdoors. An open-source coordination engine for sensors, assets, and mission systems across large-area networks where things aren't conveniently plugged into a wall.

Integrate once. Deploy everywhere. No vendor lock-in.

![Hydris Screenshot](screenshot.png)

Hydris connects heterogeneous sensors and command systems into a unified network. It provides real-time sensor fusion, automated track correlation, and coordinated response workflows - without replacing your existing systems. Built for defense, security, and civil use cases where your network of things spans kilometers, runs on battery, and can't always phone home.

- **Sensor Fusion** - Correlate tracks from public sources, local sensors, peer nodes, and radio networks into one picture
- **Multi-Domain** - Single architecture for CUAS, ground surveillance, maritime awareness, and space tracking
- **DDIL-Native** - Peer-to-peer mesh keeps operating when disconnected, disrupted, or bandwidth-limited
- **C2 Integration** - Push fused tracks into ATAK out of the box; military C2 connectors available as commercial extensions
- **API-First** - Every capability accessible via gRPC/REST; integrate in hours, not months

## Getting Started

Download hydris from https://github.com/projectqai/hydris/releases

```sh
./hydris
```

Open http://localhost:50051 in your browser. That's it.

To try a demo scenario (CUAS around Berlin with sensors and a tracked target):

```sh
bun examples/cuas/push-entities.ts
```

## Builtin Integrations

| Integration | Config Key | What It Does |
|---|---|---|
| **ADS-B** | `adsblol.location.v0` | Aircraft tracking by location, callsign, or ICAO hex via adsb.lol |
| **ADS-B Enrichment** | `adsbdb.enrich.v0` | Enriches aircraft tracks with registration, type, and operator data |
| **Hex DB** | `hexdb.enrich.v0` | ICAO hex code lookups for aircraft identification |
| **AIS** | `ais.stream.v0` | Maritime vessel tracking via NMEA AIS streams |
| **ASTERIX** | `asterix.receiver.v0` / `asterix.sender.v0` | EUROCONTROL CAT62 radar track ingestion and forwarding |
| **TAK / CoT** | `cot.server.v0` / `cot.multicast.v0` | Cursor on Target server for ATAK/WinTAK/iTAK interop |
| **Meshtastic** | `meshtastic.usb.v0` | LoRa mesh radio bridge - positions, messages, and telemetry over off-grid networks |
| **Space Track** | `spacetrack.orbit.v0` | Satellite tracking via TLE propagation (Starlink, Kuiper, custom) |
| **Federation** | `federation.push.v0` / `federation.pull.v0` | Node-to-node entity replication, optionally over WireGuard tunnels |
| **Cameras** | *(entity component)* | MJPEG, HLS, and static image feeds pinned to map locations |

## Example Config

Hydris is configured by pushing entities. You can do this via the API or by loading YAML files. Here's a maritime awareness setup with AIS tracking, aircraft monitoring, and a port camera:

```yaml
id: ais-coastal
config:
    controller: ais
    key: ais.stream.v0
    value:
        host: 153.44.253.27
        port: 5631
        latitude: 53.55
        longitude: 9.93
        entity_expiry_seconds: 300
---
id: adsb-local
config:
    controller: adsblol
    key: adsblol.location.v0
    value:
        latitude: 53.55
        longitude: 9.93
        query_type: location
        radius_nm: 500
---
id: camera-port
label: Port Camera
geo:
    latitude: 53.557
    longitude: 9.795
camera:
    cameras:
        - label: Harbor View
          protocol: CameraProtocolHls
          url: https://example.com/stream.m3u8
```

Or use the TypeScript client to push entities programmatically:

```typescript
import { WorldService } from "@projectqai/proto/world";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const transport = createConnectTransport({ baseUrl: "http://localhost:50051" });
const client = createClient(WorldService, transport);

await client.push({ changes: [{
    id: "my-sensor",
    geo: { latitude: 52.52, longitude: 13.40, altitude: 50 },
    symbol: { milStd2525C: "SFGPES----" },
}]});
```

## Documentation

- [projectqai.github.io](https://projectqai.github.io/) - Full documentation
