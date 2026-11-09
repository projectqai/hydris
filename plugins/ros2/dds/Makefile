.PHONY: generate

IMAGE := hydris-idlc:jazzy

# generate compiles std_msgs.idl to its cyclonedds C descriptors in gen/ with the
# idlc of ROS 2 Jazzy, which ships cyclonedds 0.10.5 like the plugin. -t
# leaves out XTypes type information, so peers match by type name alone,
# as ROS does across rmw implementations.
generate:
	printf 'FROM ros:jazzy-ros-base\nRUN apt-get update && apt-get install -y --no-install-recommends ros-jazzy-cyclonedds && rm -rf /var/lib/apt/lists/*\n' \
		| docker build -q -t $(IMAGE) - >/dev/null
	docker run --rm -u $$(id -u):$$(id -g) -v $(CURDIR):/w -w /w $(IMAGE) \
		/opt/ros/jazzy/bin/idlc -t -x final -o gen std_msgs.idl
