# ROS 2 Plugin

Bridges hydris routing channels and ROS 2 topics, both ways. Runs as a
native plugin on linux/amd64 and linux/arm64, with Cyclone DDS linked in:
nothing to install on the hydris side, and it talks to stock ROS 2 nodes
(Fast DDS or Cyclone DDS) on the same DDS domain.

## What goes over the wire

A channel maps to the topic `/hydris/<channel>` (`/hydris/default` for the
default channel). Messages are hydris protobuf messages carried in stock ROS
types, so the ROS side needs no extra message package:

| encoding | ROS type | payload |
|---|---|---|
| `pb` (default) | `std_msgs/msg/UInt8MultiArray` | protobuf bytes in `data` |
| `json` | `std_msgs/msg/String` | protobuf JSON in `data`, readable with `ros2 topic echo` |

- **Out:** every change of an entity routed to the channel is published as
  a `world.EntityChangeEvent`, the message `WatchEntities` streams: the
  entity and whether it was updated, expired or unobserved. Entities
  without routing stay local.
- **In:** the topic takes `world.EntityChangeRequest`, the message `Push`
  takes. Entities without their own `routing` are routed to the channel.
  Fields a different version of the protos does not know are dropped, so
  both sides may run different hydris versions.

Bridging does not loop. The plugin never hears its own publications, and
entities that already carry another hydris node in `controller.node` are
not taken in, so two hydris nodes on one domain do not bounce entities.

## Configuration

Add a `channel` device under `ros2.service`:

```yaml
id: ros2.channel.default
device: { parent: ros2.service, class: channel }
config:
  value:
    encoding: json
```

| field | default | |
|---|---|---|
| `channel` | `""` | hydris routing channel to bridge |
| `topic` | `/hydris/<channel>` | ROS topic; channel names are made legal ROS names (`ops.blue` → `ops_blue`) |
| `per_entity` | `false` | publish each entity on `<topic>/<id>` instead, keeping its last state for late subscribers; incoming messages are still read from `<topic>` |
| `max_topics` | `256` | with `per_entity`: how many topics at most |
| `encoding` | `pb` | `pb` or `json` |
| `domain_id` | `0` | `ROS_DOMAIN_ID` of the ROS nodes |

Each channel reports on its entity: `device.state` (degraded while
`max_topics` is reached), and metrics for messages and data published and
received, entities pushed, messages dropped, topics, and the data rates.

## Trying it with ROS 2

```sh
docker run -it --rm --net host -e ROS_DOMAIN_ID=0 ros:jazzy-ros-base bash
source /opt/ros/jazzy/setup.bash

# hydris -> ROS (json encoding)
ros2 topic echo --full-length /hydris/default std_msgs/msg/String

# ROS -> hydris
ros2 topic pub --once /hydris/default std_msgs/msg/String \
  '{data: "{\"changes\":[{\"id\":\"ros.robot1\",\"geo\":{\"latitude\":48.1,\"longitude\":11.6}}]}"}'
```

`--net host` matters: DDS discovery uses multicast. Without the type,
`ros2 topic echo` picks the publisher's; with `pb`, the type is
`std_msgs/msg/UInt8MultiArray`.

## Known limitations

- The plugin does not announce a ROS node, so it is missing from
  `ros2 node list`; its topics show in `ros2 topic list` as usual.
- Cyclone DDS skips what a newly matched writer sent before its first
  heartbeat. A message large enough to be fragmented (over about 64 KB)
  that is the first one of a ROS publisher that just appeared is lost;
  later ones arrive.
- DDS only: ROS nodes on `rmw_zenoh` do not see the plugin.

## Build

Needs Go, [zig](https://ziglang.org) as the C cross compiler, `cmake` and
`ninja`. The Makefile downloads Cyclone DDS 0.10.5 and links it statically.

```sh
make bin        # bin/ros2-linux-amd64, bin/ros2-linux-arm64
make build      # the plugin image
make push       # push it
make install    # upload to a running hydris and start it (SERVER=...)
```

`make -C dds generate` regenerates the type descriptors in `dds/gen/` with
the idlc of ROS 2 Jazzy, in docker.

## Test

```sh
make test               # all scenarios
make test RUN=loop      # some
```

Runs the plugin end to end against throwaway hydris instances and a ROS 2
Jazzy container (see `test/`): bridging both ways, two hydris nodes on one
domain, `max_topics` and topic churn, a burst of updates, 1 MB messages,
restarts and config changes, and the arm64 binary under qemu (skipped
without `qemu-aarch64`). Needs docker.

## License

The plugin links Cyclone DDS and musl libc statically; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
