"""Tests for HydraClient.

This module tests the HydraClient functionality using mocked gRPC calls
to avoid requiring a running Hydra server.
"""

import pytest
from unittest.mock import Mock, patch
import grpc
from platform_proto import world_pb2
from hydra_client import HydraClient


class TestHydraClientInitialization:
    """Tests for HydraClient initialization."""

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_client_initialization(self, mock_stub, mock_channel):
        """Test that client initializes correctly."""
        client = HydraClient("localhost:50051")

        assert client.server_url == "localhost:50051"
        assert client.max_retry_attempts == 10
        mock_channel.assert_called_once_with("localhost:50051")
        mock_stub.assert_called_once()


class TestHydraClientPushEntity:
    """Tests for push_entity method."""

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_push_entity_success(self, mock_stub, mock_channel):
        """Test pushing an entity successfully."""
        mock_response = world_pb2.EntityChangeResponse()
        mock_response.accepted = True

        mock_stub_instance = Mock()
        mock_stub_instance.Push.return_value = mock_response
        mock_stub.return_value = mock_stub_instance

        client = HydraClient("localhost:50051")

        entity = world_pb2.Entity()
        entity.id = "test-entity"

        result = client.push_entity(entity)

        assert result is True
        mock_stub_instance.Push.assert_called_once()

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_push_entity_rejected(self, mock_stub, mock_channel):
        """Test pushing an entity that gets rejected."""
        mock_response = world_pb2.EntityChangeResponse()
        mock_response.accepted = False

        mock_stub_instance = Mock()
        mock_stub_instance.Push.return_value = mock_response
        mock_stub.return_value = mock_stub_instance

        client = HydraClient("localhost:50051")

        entity = world_pb2.Entity()
        entity.id = "invalid-entity"

        result = client.push_entity(entity)

        assert result is False


class TestHydraClientOtherMethods:
    """Tests for other HydraClient methods."""

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_list_entities(self, mock_stub, mock_channel):
        """Test listing entities."""
        entity1 = world_pb2.Entity(id="entity-1")
        entity2 = world_pb2.Entity(id="entity-2")

        mock_response = world_pb2.ListEntitiesResponse()
        mock_response.entities.extend([entity1, entity2])

        mock_stub_instance = Mock()
        mock_stub_instance.ListEntities.return_value = mock_response
        mock_stub.return_value = mock_stub_instance

        client = HydraClient("localhost:50051")
        entities = client.list_entities()

        assert len(entities) == 2
        assert entities[0].id == "entity-1"

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_get_entity(self, mock_stub, mock_channel):
        """Test getting a single entity."""
        entity = world_pb2.Entity(id="test-entity")
        mock_response = world_pb2.GetEntityResponse()
        mock_response.entity.CopyFrom(entity)

        mock_stub_instance = Mock()
        mock_stub_instance.GetEntity.return_value = mock_response
        mock_stub.return_value = mock_stub_instance

        client = HydraClient("localhost:50051")
        result = client.get_entity("test-entity")

        assert result is not None
        assert result.id == "test-entity"

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_watch_entities(self, mock_stub, mock_channel):
        """Test watching entities stream."""
        event = world_pb2.EntityChangeEvent()
        event.t = 1
        event.entity.id = "entity-1"

        mock_stub_instance = Mock()
        mock_stub_instance.WatchEntities.return_value = iter([event])
        mock_stub.return_value = mock_stub_instance

        client = HydraClient("localhost:50051")
        watch_gen = client.watch_entities()

        first_event = next(watch_gen)
        assert first_event.entity.id == "entity-1"

    @patch("hydra_client.client.grpc.insecure_channel")
    @patch("hydra_client.client.world_pb2_grpc.WorldServiceStub")
    def test_close(self, mock_stub, mock_channel):
        """Test closing the client."""
        mock_channel_instance = Mock()
        mock_channel.return_value = mock_channel_instance

        client = HydraClient("localhost:50051")
        client.close()

        mock_channel_instance.close.assert_called_once()
        assert client.channel is None
