// Command ros2 is a native hydris plugin that bridges hydris routing
// channels and ROS 2 topics. Hydris messages travel in stock ROS types, so
// no message package is needed on the ROS side: as raw protobuf bytes in
// std_msgs/msg/UInt8MultiArray, or as protobuf JSON in std_msgs/msg/String.
//
// A channel maps to the topic /hydris/<channel>. Out, every change of an
// entity routed to the channel is published as a world.EntityChangeEvent,
// the message of WatchEntities, on that topic or fanned out to
// /hydris/<channel>/<id>. In, the topic takes world.EntityChangeRequest, the
// message of Push, and the entities are routed to the channel.
//
// Bridging never loops: a reader does not hear writers of its own process,
// and entities another hydris node published carry that node in
// controller.node, which the ingress drops as Push would reject them.
package main

import "github.com/projectqai/proto/go/sdk"

func main() { sdk.Main(Run) }
