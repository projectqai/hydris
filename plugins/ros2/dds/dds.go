// Package dds publishes and subscribes ROS 2 topics of two stock types,
// std_msgs/msg/String and std_msgs/msg/UInt8MultiArray, carrying opaque
// payloads. It binds Eclipse Cyclone DDS, linked statically; without the
// cyclonedds build tag it builds a stub whose Open fails.
package dds

import (
	"errors"
	"fmt"
	"strings"
)

// Type is the ROS 2 message type a topic carries.
type Type int

const (
	// String is std_msgs/msg/String: the payload is its data field and must
	// not contain NUL bytes.
	String Type = iota
	// Bytes is std_msgs/msg/UInt8MultiArray: the payload is its data field,
	// the layout is empty.
	Bytes
)

func (t Type) String() string {
	switch t {
	case String:
		return "std_msgs/msg/String"
	case Bytes:
		return "std_msgs/msg/UInt8MultiArray"
	}
	return fmt.Sprintf("Type(%d)", int(t))
}

// ErrUnavailable is returned by Open in a build without cyclonedds.
var ErrUnavailable = errors.New("built without cyclonedds")

// QoS of a writer. Writers and readers are always reliable; readers are
// volatile with keep-last ReaderDepth, which matches any writer.
type QoS struct {
	// TransientLocal keeps the last Depth messages for subscribers that
	// join later.
	TransientLocal bool
	// Depth is the keep-last history: deep enough that a burst, like the
	// whole world at start, reaches a reliable reader.
	Depth int
}

// ReaderDepth is the keep-last history of every reader.
const ReaderDepth = 1000

// CheckTopic reports whether name is a ROS topic name this package takes:
// absolute, letters, digits, _ and /.
func CheckTopic(name string) error {
	_, err := ddsTopic(name)
	return err
}

// ddsTopic is the DDS topic of the ROS topic name: ROS prefixes topics
// with "rt", so /hydris/entities is rt/hydris/entities.
func ddsTopic(name string) (string, error) {
	if !strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") || strings.Contains(name, "//") {
		return "", fmt.Errorf("topic %q: want an absolute ROS name like /hydris/entities", name)
	}
	for _, r := range name {
		if r != '/' && r != '_' && !alnum(r) {
			return "", fmt.Errorf("topic %q: only letters, digits, _ and /", name)
		}
	}
	return "rt" + name, nil
}

func alnum(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}
