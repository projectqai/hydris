import world_pb2 as _world_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ControllerDeviceConfigurationEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ControllerDeviceConfigurationEventNew: _ClassVar[ControllerDeviceConfigurationEventType]
    ControllerDeviceConfigurationEventChanged: _ClassVar[ControllerDeviceConfigurationEventType]
    ControllerDeviceConfigurationEventRemoved: _ClassVar[ControllerDeviceConfigurationEventType]
ControllerDeviceConfigurationEventNew: ControllerDeviceConfigurationEventType
ControllerDeviceConfigurationEventChanged: ControllerDeviceConfigurationEventType
ControllerDeviceConfigurationEventRemoved: ControllerDeviceConfigurationEventType

class ControllerReconciliationRequest(_message.Message):
    __slots__ = ("controller",)
    CONTROLLER_FIELD_NUMBER: _ClassVar[int]
    controller: str
    def __init__(self, controller: _Optional[str] = ...) -> None: ...

class ControllerDeviceConfigurationEvent(_message.Message):
    __slots__ = ("t", "config")
    T_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    t: ControllerDeviceConfigurationEventType
    config: _world_pb2.Entity
    def __init__(self, t: _Optional[_Union[ControllerDeviceConfigurationEventType, str]] = ..., config: _Optional[_Union[_world_pb2.Entity, _Mapping]] = ...) -> None: ...

class ControllerReconciliationEvent(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: ControllerDeviceConfigurationEvent
    def __init__(self, config: _Optional[_Union[ControllerDeviceConfigurationEvent, _Mapping]] = ...) -> None: ...

class RestartConnectorRequest(_message.Message):
    __slots__ = ("controller", "entity_id")
    CONTROLLER_FIELD_NUMBER: _ClassVar[int]
    ENTITY_ID_FIELD_NUMBER: _ClassVar[int]
    controller: str
    entity_id: str
    def __init__(self, controller: _Optional[str] = ..., entity_id: _Optional[str] = ...) -> None: ...

class RestartConnectorResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
