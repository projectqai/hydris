import geometry_pb2 as _geometry_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TaskableTarget(_message.Message):
    __slots__ = ("position", "waypoints", "entity", "mode")
    POSITION_FIELD_NUMBER: _ClassVar[int]
    WAYPOINTS_FIELD_NUMBER: _ClassVar[int]
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    position: TaskableTargetPosition
    waypoints: TaskableTargetWaypoints
    entity: TaskableTargetEntity
    mode: TaskableTargetMode
    def __init__(self, position: _Optional[_Union[TaskableTargetPosition, _Mapping]] = ..., waypoints: _Optional[_Union[TaskableTargetWaypoints, _Mapping]] = ..., entity: _Optional[_Union[TaskableTargetEntity, _Mapping]] = ..., mode: _Optional[_Union[TaskableTargetMode, _Mapping]] = ...) -> None: ...

class TaskableTargetMode(_message.Message):
    __slots__ = ("options", "active", "until", "next", "on")
    OPTIONS_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    UNTIL_FIELD_NUMBER: _ClassVar[int]
    NEXT_FIELD_NUMBER: _ClassVar[int]
    ON_FIELD_NUMBER: _ClassVar[int]
    options: _containers.RepeatedCompositeFieldContainer[TaskableTargetModeOption]
    active: str
    until: _timestamp_pb2.Timestamp
    next: str
    on: str
    def __init__(self, options: _Optional[_Iterable[_Union[TaskableTargetModeOption, _Mapping]]] = ..., active: _Optional[str] = ..., until: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., next: _Optional[str] = ..., on: _Optional[str] = ...) -> None: ...

class TaskableTargetModeOption(_message.Message):
    __slots__ = ("id", "label", "description", "disabled")
    ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DISABLED_FIELD_NUMBER: _ClassVar[int]
    id: str
    label: str
    description: str
    disabled: str
    def __init__(self, id: _Optional[str] = ..., label: _Optional[str] = ..., description: _Optional[str] = ..., disabled: _Optional[str] = ...) -> None: ...

class TaskableTargetPosition(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskableTargetWaypoints(_message.Message):
    __slots__ = ("max", "loop")
    MAX_FIELD_NUMBER: _ClassVar[int]
    LOOP_FIELD_NUMBER: _ClassVar[int]
    max: int
    loop: bool
    def __init__(self, max: _Optional[int] = ..., loop: bool = ...) -> None: ...

class TaskableTargetEntity(_message.Message):
    __slots__ = ("entity", "max")
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    entity: _containers.RepeatedScalarFieldContainer[str]
    max: int
    def __init__(self, entity: _Optional[_Iterable[str]] = ..., max: _Optional[int] = ...) -> None: ...

class TaskExecutionTarget(_message.Message):
    __slots__ = ("position", "waypoints", "entity", "mode")
    POSITION_FIELD_NUMBER: _ClassVar[int]
    WAYPOINTS_FIELD_NUMBER: _ClassVar[int]
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    position: _geometry_pb2.PlanarPoint
    waypoints: TaskExecutionTargetWaypoints
    entity: TaskExecutionTargetEntity
    mode: str
    def __init__(self, position: _Optional[_Union[_geometry_pb2.PlanarPoint, _Mapping]] = ..., waypoints: _Optional[_Union[TaskExecutionTargetWaypoints, _Mapping]] = ..., entity: _Optional[_Union[TaskExecutionTargetEntity, _Mapping]] = ..., mode: _Optional[str] = ...) -> None: ...

class TaskExecutionTargetWaypoints(_message.Message):
    __slots__ = ("waypoint",)
    WAYPOINT_FIELD_NUMBER: _ClassVar[int]
    waypoint: _containers.RepeatedCompositeFieldContainer[_geometry_pb2.PlanarPoint]
    def __init__(self, waypoint: _Optional[_Iterable[_Union[_geometry_pb2.PlanarPoint, _Mapping]]] = ...) -> None: ...

class TaskExecutionTargetEntity(_message.Message):
    __slots__ = ("entity",)
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    entity: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, entity: _Optional[_Iterable[str]] = ...) -> None: ...
