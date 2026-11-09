"""Tests for platform-proto protobuf bindings.

This module tests that the generated protobuf code imports correctly,
messages can be created and serialized, and all expected fields exist.
"""

import pytest
from google.protobuf import timestamp_pb2


class TestTimelineProto:
    """Tests for timeline.proto bindings."""

    def test_timeline_bindings(self):
        """Test timeline proto imports and basic usage."""
        from platform_proto import timeline_pb2, timeline_pb2_grpc

        # Test imports
        assert timeline_pb2 is not None
        assert timeline_pb2_grpc is not None
        assert hasattr(timeline_pb2_grpc, "TimelineServiceStub")

        # Test message creation
        request = timeline_pb2.MoveTimelineRequest()
        request.freeze = True
        assert request.freeze is True


class TestWorldProto:
    """Tests for world.proto bindings."""

    def test_world_bindings(self):
        """Test world proto imports and basic usage."""
        from platform_proto import world_pb2, world_pb2_grpc

        # Test imports
        assert world_pb2 is not None
        assert world_pb2_grpc is not None
        assert hasattr(world_pb2_grpc, "WorldServiceStub")

        # Test request creation
        request = world_pb2.GetEntityRequest()
        request.id = "entity-123"
        assert request.id == "entity-123"

    def test_entity_creation(self):
        """Test creating an Entity with components."""
        from platform_proto import world_pb2

        entity = world_pb2.Entity()
        entity.id = "test-entity"

        # Geo component
        entity.geo.longitude = -73.935242
        entity.geo.latitude = 40.730610
        entity.geo.altitude = 10.0

        # Controller
        entity.controller.id = "test-controller"

        # Bearing
        entity.bearing.azimuth = 45.5
        entity.bearing.elevation = 15.2

        # Detection
        entity.detection.classification = "Drone"

        assert entity.id == "test-entity"
        assert entity.geo.longitude == -73.935242
        assert entity.bearing.azimuth == 45.5
        assert entity.detection.classification == "Drone"

    def test_entity_serialization(self):
        """Test Entity serialization/deserialization."""
        from platform_proto import world_pb2

        original = world_pb2.Entity()
        original.id = "test"
        original.geo.longitude = -73.9
        original.geo.latitude = 40.7

        # Serialize and deserialize
        serialized = original.SerializeToString()
        deserialized = world_pb2.Entity()
        deserialized.ParseFromString(serialized)

        assert deserialized.id == original.id
        assert deserialized.geo.longitude == original.geo.longitude


