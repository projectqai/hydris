from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ManualControlInput(_message.Message):
    __slots__ = ("axes",)
    AXES_FIELD_NUMBER: _ClassVar[int]
    axes: ManualControlAxes
    def __init__(self, axes: _Optional[_Union[ManualControlAxes, _Mapping]] = ...) -> None: ...

class ManualControlAxes(_message.Message):
    __slots__ = ("forward", "right", "up", "yaw", "pitch", "roll", "pan", "tilt", "zoom")
    FORWARD_FIELD_NUMBER: _ClassVar[int]
    RIGHT_FIELD_NUMBER: _ClassVar[int]
    UP_FIELD_NUMBER: _ClassVar[int]
    YAW_FIELD_NUMBER: _ClassVar[int]
    PITCH_FIELD_NUMBER: _ClassVar[int]
    ROLL_FIELD_NUMBER: _ClassVar[int]
    PAN_FIELD_NUMBER: _ClassVar[int]
    TILT_FIELD_NUMBER: _ClassVar[int]
    ZOOM_FIELD_NUMBER: _ClassVar[int]
    forward: float
    right: float
    up: float
    yaw: float
    pitch: float
    roll: float
    pan: float
    tilt: float
    zoom: float
    def __init__(self, forward: _Optional[float] = ..., right: _Optional[float] = ..., up: _Optional[float] = ..., yaw: _Optional[float] = ..., pitch: _Optional[float] = ..., roll: _Optional[float] = ..., pan: _Optional[float] = ..., tilt: _Optional[float] = ..., zoom: _Optional[float] = ...) -> None: ...
