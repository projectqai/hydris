#!/usr/bin/env python3
"""The ROS 2 side of the ros2 plugin tests. Runs one command and prints its
result as JSON on stdout.

  listen TOPIC TYPE SECONDS [transient]  count messages, per entity id
  publish TOPIC TYPE FILE COUNT          publish FILE's content COUNT times
  topics PREFIX SECONDS                  topics under PREFIX after SECONDS

TYPE is string (std_msgs/String) or bytes (std_msgs/UInt8MultiArray).
"""
import array
import json
import sys
import time

import rclpy
from rclpy.duration import Duration
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String, UInt8MultiArray

TYPES = {"string": String, "bytes": UInt8MultiArray}


def qos(transient, depth):
    return QoSProfile(
        reliability=ReliabilityPolicy.RELIABLE,
        durability=DurabilityPolicy.TRANSIENT_LOCAL if transient else DurabilityPolicy.VOLATILE,
        history=HistoryPolicy.KEEP_LAST,
        depth=depth,
    )


def payload(msg):
    return msg.data.encode() if isinstance(msg, String) else bytes(msg.data)


def spin(node, seconds):
    end = time.time() + seconds
    while time.time() < end:
        rclpy.spin_once(node, timeout_sec=0.05)


def listen(node, topic, typ, seconds, transient=""):
    got = []
    node.create_subscription(TYPES[typ], topic, lambda m: got.append(payload(m)), qos(transient == "transient", 100000))
    spin(node, float(seconds))
    ids, last = {}, {}
    for p in got:
        # A world.EntityChangeEvent in JSON: the entity, and the change.
        try:
            ev = json.loads(p)
        except ValueError:
            ev = {}
        e = ev.get("entity", {}) if isinstance(ev, dict) else {}
        i = e.get("id", "")
        ids[i] = ids.get(i, 0) + 1
        last[i] = e.get("label", "")
    return {"count": len(got), "ids": ids, "last": last, "max_size": max((len(p) for p in got), default=0)}


def publish(node, topic, typ, path, count):
    data = open(path, "rb").read()
    pub = node.create_publisher(TYPES[typ], topic, qos(False, 1000))
    # Wait for the plugin's reader, so the message is not sent into the void.
    end = time.time() + 15
    while pub.get_subscription_count() == 0 and time.time() < end:
        rclpy.spin_once(node, timeout_sec=0.1)
    # Matching is not symmetric: the reader matches this writer a moment
    # later, and a volatile reader skips what the writer had sent by then,
    # as history it did not ask for. A small message usually gets through
    # anyway; a fragmented one, still in flight, is skipped. Give the reader
    # time, as a long-running ROS node has.
    spin(node, 3)
    msg = TYPES[typ]()
    msg.data = data.decode() if typ == "string" else array.array("B", data)
    for _ in range(int(count)):
        pub.publish(msg)
    # Stay until every reader acknowledged: a retransmission waits for the
    # writer's heartbeat, every 3 s with Fast DDS, and exiting first loses it.
    acked = pub.wait_for_all_acked(Duration(seconds=30))
    return {"subscribers": pub.get_subscription_count(), "acked": acked}


def topics(node, prefix, seconds):
    spin(node, float(seconds))
    return {"topics": sorted(n for n, _ in node.get_topic_names_and_types() if n.startswith(prefix))}


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    rclpy.init()
    node = Node("hydris_test_agent")
    out = {"listen": listen, "publish": publish, "topics": topics}[cmd](node, *args)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
