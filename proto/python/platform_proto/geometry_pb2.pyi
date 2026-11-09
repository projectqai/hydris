from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LineStyle(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LineStyleSolid: _ClassVar[LineStyle]
    LineStyleDashed: _ClassVar[LineStyle]
    LineStyleDotted: _ClassVar[LineStyle]
LineStyleSolid: LineStyle
LineStyleDashed: LineStyle
LineStyleDotted: LineStyle

class PlanarPoint(_message.Message):
    __slots__ = ("longitude", "latitude", "altitude", "entity")
    LONGITUDE_FIELD_NUMBER: _ClassVar[int]
    LATITUDE_FIELD_NUMBER: _ClassVar[int]
    ALTITUDE_FIELD_NUMBER: _ClassVar[int]
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    longitude: float
    latitude: float
    altitude: float
    entity: str
    def __init__(self, longitude: _Optional[float] = ..., latitude: _Optional[float] = ..., altitude: _Optional[float] = ..., entity: _Optional[str] = ...) -> None: ...

class PlanarRing(_message.Message):
    __slots__ = ("points",)
    POINTS_FIELD_NUMBER: _ClassVar[int]
    points: _containers.RepeatedCompositeFieldContainer[PlanarPoint]
    def __init__(self, points: _Optional[_Iterable[_Union[PlanarPoint, _Mapping]]] = ...) -> None: ...

class PlanarPolygon(_message.Message):
    __slots__ = ("outer", "holes")
    OUTER_FIELD_NUMBER: _ClassVar[int]
    HOLES_FIELD_NUMBER: _ClassVar[int]
    outer: PlanarRing
    holes: _containers.RepeatedCompositeFieldContainer[PlanarRing]
    def __init__(self, outer: _Optional[_Union[PlanarRing, _Mapping]] = ..., holes: _Optional[_Iterable[_Union[PlanarRing, _Mapping]]] = ...) -> None: ...

class PlanarCircle(_message.Message):
    __slots__ = ("center", "radius_m", "inner_radius_m")
    CENTER_FIELD_NUMBER: _ClassVar[int]
    RADIUS_M_FIELD_NUMBER: _ClassVar[int]
    INNER_RADIUS_M_FIELD_NUMBER: _ClassVar[int]
    center: PlanarPoint
    radius_m: float
    inner_radius_m: float
    def __init__(self, center: _Optional[_Union[PlanarPoint, _Mapping]] = ..., radius_m: _Optional[float] = ..., inner_radius_m: _Optional[float] = ...) -> None: ...

class PlanarGeometryCollection(_message.Message):
    __slots__ = ("geometries",)
    GEOMETRIES_FIELD_NUMBER: _ClassVar[int]
    geometries: _containers.RepeatedCompositeFieldContainer[PlanarGeometry]
    def __init__(self, geometries: _Optional[_Iterable[_Union[PlanarGeometry, _Mapping]]] = ...) -> None: ...

class PlanarGeometry(_message.Message):
    __slots__ = ("point", "line", "polygon", "circle", "collection", "line_style")
    POINT_FIELD_NUMBER: _ClassVar[int]
    LINE_FIELD_NUMBER: _ClassVar[int]
    POLYGON_FIELD_NUMBER: _ClassVar[int]
    CIRCLE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    LINE_STYLE_FIELD_NUMBER: _ClassVar[int]
    point: PlanarPoint
    line: PlanarRing
    polygon: PlanarPolygon
    circle: PlanarCircle
    collection: PlanarGeometryCollection
    line_style: LineStyle
    def __init__(self, point: _Optional[_Union[PlanarPoint, _Mapping]] = ..., line: _Optional[_Union[PlanarRing, _Mapping]] = ..., polygon: _Optional[_Union[PlanarPolygon, _Mapping]] = ..., circle: _Optional[_Union[PlanarCircle, _Mapping]] = ..., collection: _Optional[_Union[PlanarGeometryCollection, _Mapping]] = ..., line_style: _Optional[_Union[LineStyle, str]] = ...) -> None: ...

class LocalPoint(_message.Message):
    __slots__ = ("east_m", "north_m", "up_m")
    EAST_M_FIELD_NUMBER: _ClassVar[int]
    NORTH_M_FIELD_NUMBER: _ClassVar[int]
    UP_M_FIELD_NUMBER: _ClassVar[int]
    east_m: float
    north_m: float
    up_m: float
    def __init__(self, east_m: _Optional[float] = ..., north_m: _Optional[float] = ..., up_m: _Optional[float] = ...) -> None: ...

class LocalRing(_message.Message):
    __slots__ = ("points",)
    POINTS_FIELD_NUMBER: _ClassVar[int]
    points: _containers.RepeatedCompositeFieldContainer[LocalPoint]
    def __init__(self, points: _Optional[_Iterable[_Union[LocalPoint, _Mapping]]] = ...) -> None: ...

class LocalPolygon(_message.Message):
    __slots__ = ("outer", "holes")
    OUTER_FIELD_NUMBER: _ClassVar[int]
    HOLES_FIELD_NUMBER: _ClassVar[int]
    outer: LocalRing
    holes: _containers.RepeatedCompositeFieldContainer[LocalRing]
    def __init__(self, outer: _Optional[_Union[LocalRing, _Mapping]] = ..., holes: _Optional[_Iterable[_Union[LocalRing, _Mapping]]] = ...) -> None: ...

class LocalCircle(_message.Message):
    __slots__ = ("center", "radius_m", "inner_radius_m")
    CENTER_FIELD_NUMBER: _ClassVar[int]
    RADIUS_M_FIELD_NUMBER: _ClassVar[int]
    INNER_RADIUS_M_FIELD_NUMBER: _ClassVar[int]
    center: LocalPoint
    radius_m: float
    inner_radius_m: float
    def __init__(self, center: _Optional[_Union[LocalPoint, _Mapping]] = ..., radius_m: _Optional[float] = ..., inner_radius_m: _Optional[float] = ...) -> None: ...

class LocalGeometryCollection(_message.Message):
    __slots__ = ("geometries",)
    GEOMETRIES_FIELD_NUMBER: _ClassVar[int]
    geometries: _containers.RepeatedCompositeFieldContainer[LocalGeometry]
    def __init__(self, geometries: _Optional[_Iterable[_Union[LocalGeometry, _Mapping]]] = ...) -> None: ...

class LocalGeometry(_message.Message):
    __slots__ = ("point", "line", "polygon", "circle", "collection", "line_style")
    POINT_FIELD_NUMBER: _ClassVar[int]
    LINE_FIELD_NUMBER: _ClassVar[int]
    POLYGON_FIELD_NUMBER: _ClassVar[int]
    CIRCLE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    LINE_STYLE_FIELD_NUMBER: _ClassVar[int]
    point: LocalPoint
    line: LocalRing
    polygon: LocalPolygon
    circle: LocalCircle
    collection: LocalGeometryCollection
    line_style: LineStyle
    def __init__(self, point: _Optional[_Union[LocalPoint, _Mapping]] = ..., line: _Optional[_Union[LocalRing, _Mapping]] = ..., polygon: _Optional[_Union[LocalPolygon, _Mapping]] = ..., circle: _Optional[_Union[LocalCircle, _Mapping]] = ..., collection: _Optional[_Union[LocalGeometryCollection, _Mapping]] = ..., line_style: _Optional[_Union[LineStyle, str]] = ...) -> None: ...

class FillStyle(_message.Message):
    __slots__ = ("color", "opacity", "texture", "texture_scale_m")
    COLOR_FIELD_NUMBER: _ClassVar[int]
    OPACITY_FIELD_NUMBER: _ClassVar[int]
    TEXTURE_FIELD_NUMBER: _ClassVar[int]
    TEXTURE_SCALE_M_FIELD_NUMBER: _ClassVar[int]
    color: str
    opacity: float
    texture: str
    texture_scale_m: float
    def __init__(self, color: _Optional[str] = ..., opacity: _Optional[float] = ..., texture: _Optional[str] = ..., texture_scale_m: _Optional[float] = ...) -> None: ...

class GeometryExtrusion(_message.Message):
    __slots__ = ("fill", "height_m")
    FILL_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_M_FIELD_NUMBER: _ClassVar[int]
    fill: FillStyle
    height_m: float
    def __init__(self, fill: _Optional[_Union[FillStyle, _Mapping]] = ..., height_m: _Optional[float] = ...) -> None: ...
