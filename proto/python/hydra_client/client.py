"""
Hydra gRPC client for pushing and watching entities.

This client provides a Python interface to the Hydra WorldService,
allowing services to push track entities and watch for detection entities.
"""

import logging
import time
from typing import Iterator, Optional

import grpc
from platform_proto import world_pb2, world_pb2_grpc

logger = logging.getLogger(__name__)


class HydraClient:
    """gRPC client for Hydra WorldService."""

    def __init__(
        self,
        server_url: str,
        max_retry_attempts: int = 10,
        initial_backoff: float = 0.1,
        max_backoff: float = 5.0,
        backoff_multiplier: float = 2.0,
    ):
        """
        Initialize Hydra client.

        Parameters
        ----------
        server_url : str
            Hydra server address (e.g., "localhost:50051")
        max_retry_attempts : int
            Maximum number of retry attempts for failed calls
        initial_backoff : float
            Initial backoff delay in seconds
        max_backoff : float
            Maximum backoff delay in seconds
        backoff_multiplier : float
            Multiplier for exponential backoff
        """
        self.server_url = server_url
        self.max_retry_attempts = max_retry_attempts
        self.initial_backoff = initial_backoff
        self.max_backoff = max_backoff
        self.backoff_multiplier = backoff_multiplier

        self.channel: Optional[grpc.Channel] = None
        self.stub: Optional[world_pb2_grpc.WorldServiceStub] = None
        self._connect()

    def _connect(self):
        """Establish gRPC connection to Hydra server."""
        try:
            logger.info(f"[HydraClient] Connecting to Hydra at {self.server_url}")
            self.channel = grpc.insecure_channel(self.server_url)
            self.stub = world_pb2_grpc.WorldServiceStub(self.channel)
            logger.info("[HydraClient] Connected successfully")
        except Exception as e:
            logger.error(f"[HydraClient] Connection failed: {e}")
            raise

    def _retry_call(self, func, *args, **kwargs):
        """
        Execute a gRPC call with exponential backoff retry.

        Parameters
        ----------
        func : callable
            The gRPC method to call
        *args, **kwargs
            Arguments to pass to the function

        Returns
        -------
        Response from the gRPC call

        Raises
        ------
        grpc.RpcError
            If all retry attempts fail
        """
        backoff = self.initial_backoff
        last_error = None

        for attempt in range(self.max_retry_attempts):
            try:
                return func(*args, **kwargs)
            except grpc.RpcError as e:
                last_error = e
                code = e.code()

                # Only retry on specific error codes
                if code not in (
                    grpc.StatusCode.UNAVAILABLE,
                    grpc.StatusCode.RESOURCE_EXHAUSTED,
                    grpc.StatusCode.ABORTED,
                    grpc.StatusCode.INTERNAL,
                    grpc.StatusCode.UNKNOWN,
                ):
                    logger.error(
                        f"[HydraClient] Non-retryable error: {code} - {e.details()}"
                    )
                    raise

                if attempt < self.max_retry_attempts - 1:
                    logger.warning(
                        f"[HydraClient] Call failed (attempt {attempt + 1}/"
                        f"{self.max_retry_attempts}): {code}. "
                        f"Retrying in {backoff:.2f}s..."
                    )
                    time.sleep(backoff)
                    backoff = min(backoff * self.backoff_multiplier, self.max_backoff)
                else:
                    logger.error(
                        f"[HydraClient] All retry attempts exhausted: {code} - "
                        f"{e.details()}"
                    )

        raise last_error

    def push_entity(self, entity: world_pb2.Entity, timeout: float = 5.0) -> bool:
        """
        Push an entity to Hydra.

        Parameters
        ----------
        entity : world_pb2.Entity
            The entity to push
        timeout : float
            RPC timeout in seconds

        Returns
        -------
        bool
            True if the entity was accepted, False otherwise
        """
        try:
            request = world_pb2.EntityChangeRequest(changes=[entity])
            response = self._retry_call(self.stub.Push, request, timeout=timeout)

            if response.accepted:
                logger.debug(f"[HydraClient] Entity {entity.id} pushed successfully")
            else:
                logger.warning(
                    f"[HydraClient] Entity {entity.id} rejected: {response.debug}"
                )

            return response.accepted

        except grpc.RpcError as e:
            logger.error(f"[HydraClient] Push failed for entity {entity.id}: {e}")
            return False

    def push_entities(
        self, entities: list[world_pb2.Entity], timeout: float = 5.0
    ) -> bool:
        """
        Push multiple entities to Hydra in a single request.

        Parameters
        ----------
        entities : list[world_pb2.Entity]
            List of entities to push
        timeout : float
            RPC timeout in seconds

        Returns
        -------
        bool
            True if all entities were accepted, False otherwise
        """
        if not entities:
            return True

        try:
            request = world_pb2.EntityChangeRequest(changes=entities)
            response = self._retry_call(self.stub.Push, request, timeout=timeout)

            if response.accepted:
                logger.debug(
                    f"[HydraClient] {len(entities)} entities pushed successfully"
                )
            else:
                logger.warning(f"[HydraClient] Entities rejected: {response.debug}")

            return response.accepted

        except grpc.RpcError as e:
            logger.error(f"[HydraClient] Batch push failed: {e}")
            return False

    def list_entities(
        self, geo_filter: Optional[bytes] = None, timeout: float = 5.0
    ) -> list[world_pb2.Entity]:
        """
        List all entities in Hydra (optionally filtered by geometry).

        Parameters
        ----------
        geo_filter : Optional[bytes]
            WKB geometry to filter entities by region
        timeout : float
            RPC timeout in seconds

        Returns
        -------
        list[world_pb2.Entity]
            List of entities
        """
        try:
            request = world_pb2.ListEntitiesRequest()
            if geo_filter:
                request.geo.wkb = geo_filter

            response = self._retry_call(
                self.stub.ListEntities, request, timeout=timeout
            )
            logger.debug(f"[HydraClient] Listed {len(response.entities)} entities")
            return list(response.entities)

        except grpc.RpcError as e:
            logger.error(f"[HydraClient] ListEntities failed: {e}")
            return []

    def get_entity(
        self, entity_id: str, timeout: float = 5.0
    ) -> Optional[world_pb2.Entity]:
        """
        Get a specific entity by ID.

        Parameters
        ----------
        entity_id : str
            The entity ID
        timeout : float
            RPC timeout in seconds

        Returns
        -------
        Optional[world_pb2.Entity]
            The entity, or None if not found
        """
        try:
            request = world_pb2.GetEntityRequest(id=entity_id)
            response = self._retry_call(self.stub.GetEntity, request, timeout=timeout)
            logger.debug(f"[HydraClient] Retrieved entity {entity_id}")
            return response.entity

        except grpc.RpcError as e:
            if e.code() == grpc.StatusCode.NOT_FOUND:
                logger.debug(f"[HydraClient] Entity {entity_id} not found")
            else:
                logger.error(f"[HydraClient] GetEntity failed: {e}")
            return None

    def watch_entities(
        self, geo_filter: Optional[bytes] = None
    ) -> Iterator[world_pb2.EntityChangeEvent]:
        """
        Watch for entity changes (streaming RPC).

        This is a generator that yields EntityChangeEvent objects as they
        arrive from Hydra. The stream will automatically retry on transient
        failures.

        Parameters
        ----------
        geo_filter : Optional[bytes]
            WKB geometry to filter entities by region

        Yields
        ------
        world_pb2.EntityChangeEvent
            Entity change events (Updated, Expired, Unobserved)
        """
        while True:
            try:
                request = world_pb2.ListEntitiesRequest()
                if geo_filter:
                    request.geo.wkb = geo_filter

                logger.info("[HydraClient] Starting WatchEntities stream...")
                stream = self.stub.WatchEntities(request)

                for event in stream:
                    logger.debug(
                        f"[HydraClient] Received event: "
                        f"{world_pb2.EntityChange.Name(event.t)} "
                        f"for entity {event.entity.id}"
                    )
                    yield event

            except grpc.RpcError as e:
                code = e.code()
                logger.error(f"[HydraClient] WatchEntities stream error: {code}")

                # Check if we should retry
                if code in (
                    grpc.StatusCode.UNAVAILABLE,
                    grpc.StatusCode.RESOURCE_EXHAUSTED,
                    grpc.StatusCode.ABORTED,
                    grpc.StatusCode.INTERNAL,
                    grpc.StatusCode.UNKNOWN,
                ):
                    logger.info("[HydraClient] Retrying stream in 1s...")
                    time.sleep(1)
                else:
                    logger.error("[HydraClient] Non-retryable stream error, exiting")
                    break

    def close(self):
        """Close the gRPC channel."""
        if self.channel:
            logger.info("[HydraClient] Closing connection")
            self.channel.close()
            self.channel = None
            self.stub = None
