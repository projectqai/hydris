import world_pb2 as _world_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DownloadArtifactRequest(_message.Message):
    __slots__ = ("id", "sha256")
    ID_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    id: str
    sha256: str
    def __init__(self, id: _Optional[str] = ..., sha256: _Optional[str] = ...) -> None: ...

class DownloadArtifactResponse(_message.Message):
    __slots__ = ("meta", "chunk")
    META_FIELD_NUMBER: _ClassVar[int]
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    meta: _world_pb2.ArtifactComponent
    chunk: bytes
    def __init__(self, meta: _Optional[_Union[_world_pb2.ArtifactComponent, _Mapping]] = ..., chunk: _Optional[bytes] = ...) -> None: ...

class UploadArtifactRequest(_message.Message):
    __slots__ = ("id", "chunk", "content_type")
    ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    id: str
    chunk: bytes
    content_type: str
    def __init__(self, id: _Optional[str] = ..., chunk: _Optional[bytes] = ..., content_type: _Optional[str] = ...) -> None: ...

class UploadArtifactResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
