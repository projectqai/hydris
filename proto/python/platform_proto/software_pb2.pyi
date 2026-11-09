from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SoftwareState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SoftwareStateUnspecified: _ClassVar[SoftwareState]
    SoftwareStateBooted: _ClassVar[SoftwareState]
    SoftwareStateNext: _ClassVar[SoftwareState]
    SoftwareStateInactive: _ClassVar[SoftwareState]
    SoftwareStateBad: _ClassVar[SoftwareState]
    SoftwareStateInstallable: _ClassVar[SoftwareState]
SoftwareStateUnspecified: SoftwareState
SoftwareStateBooted: SoftwareState
SoftwareStateNext: SoftwareState
SoftwareStateInactive: SoftwareState
SoftwareStateBad: SoftwareState
SoftwareStateInstallable: SoftwareState

class Software(_message.Message):
    __slots__ = ("version", "compatible", "digest")
    VERSION_FIELD_NUMBER: _ClassVar[int]
    COMPATIBLE_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    version: str
    compatible: str
    digest: str
    def __init__(self, version: _Optional[str] = ..., compatible: _Optional[str] = ..., digest: _Optional[str] = ...) -> None: ...

class DeviceSoftwareEntry(_message.Message):
    __slots__ = ("software", "state", "slot", "task")
    SOFTWARE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SLOT_FIELD_NUMBER: _ClassVar[int]
    TASK_FIELD_NUMBER: _ClassVar[int]
    software: Software
    state: SoftwareState
    slot: str
    task: str
    def __init__(self, software: _Optional[_Union[Software, _Mapping]] = ..., state: _Optional[_Union[SoftwareState, str]] = ..., slot: _Optional[str] = ..., task: _Optional[str] = ...) -> None: ...

class DeviceSoftware(_message.Message):
    __slots__ = ("software",)
    SOFTWARE_FIELD_NUMBER: _ClassVar[int]
    software: _containers.RepeatedCompositeFieldContainer[DeviceSoftwareEntry]
    def __init__(self, software: _Optional[_Iterable[_Union[DeviceSoftwareEntry, _Mapping]]] = ...) -> None: ...

class SoftwareArtifact(_message.Message):
    __slots__ = ("software",)
    SOFTWARE_FIELD_NUMBER: _ClassVar[int]
    software: _containers.RepeatedCompositeFieldContainer[Software]
    def __init__(self, software: _Optional[_Iterable[_Union[Software, _Mapping]]] = ...) -> None: ...
