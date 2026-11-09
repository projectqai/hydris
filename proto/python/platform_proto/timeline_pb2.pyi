from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetTimelineRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetTimelineResponse(_message.Message):
    __slots__ = ("min", "max", "frozen", "at")
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    FROZEN_FIELD_NUMBER: _ClassVar[int]
    AT_FIELD_NUMBER: _ClassVar[int]
    min: _timestamp_pb2.Timestamp
    max: _timestamp_pb2.Timestamp
    frozen: bool
    at: _timestamp_pb2.Timestamp
    def __init__(self, min: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., max: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., frozen: bool = ..., at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class MoveTimelineRequest(_message.Message):
    __slots__ = ("freeze", "at")
    FREEZE_FIELD_NUMBER: _ClassVar[int]
    AT_FIELD_NUMBER: _ClassVar[int]
    freeze: bool
    at: _timestamp_pb2.Timestamp
    def __init__(self, freeze: bool = ..., at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class MoveTimelineResponse(_message.Message):
    __slots__ = ("current",)
    CURRENT_FIELD_NUMBER: _ClassVar[int]
    current: _timestamp_pb2.Timestamp
    def __init__(self, current: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
