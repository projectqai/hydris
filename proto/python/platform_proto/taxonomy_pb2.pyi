from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ClassificationTaxonomy(_message.Message):
    __slots__ = ("confidence", "person", "animal", "infrastructure", "vehicle", "equipment", "emitter", "other")
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    PERSON_FIELD_NUMBER: _ClassVar[int]
    ANIMAL_FIELD_NUMBER: _ClassVar[int]
    INFRASTRUCTURE_FIELD_NUMBER: _ClassVar[int]
    VEHICLE_FIELD_NUMBER: _ClassVar[int]
    EQUIPMENT_FIELD_NUMBER: _ClassVar[int]
    EMITTER_FIELD_NUMBER: _ClassVar[int]
    OTHER_FIELD_NUMBER: _ClassVar[int]
    confidence: ClassificationConfidence
    person: PersonTaxonomy
    animal: AnimalTaxonomy
    infrastructure: InfrastructureTaxonomy
    vehicle: VehicleTaxonomy
    equipment: EquipmentTaxonomy
    emitter: EmitterTaxonomy
    other: OtherTaxonomy
    def __init__(self, confidence: _Optional[_Union[ClassificationConfidence, _Mapping]] = ..., person: _Optional[_Union[PersonTaxonomy, _Mapping]] = ..., animal: _Optional[_Union[AnimalTaxonomy, _Mapping]] = ..., infrastructure: _Optional[_Union[InfrastructureTaxonomy, _Mapping]] = ..., vehicle: _Optional[_Union[VehicleTaxonomy, _Mapping]] = ..., equipment: _Optional[_Union[EquipmentTaxonomy, _Mapping]] = ..., emitter: _Optional[_Union[EmitterTaxonomy, _Mapping]] = ..., other: _Optional[_Union[OtherTaxonomy, _Mapping]] = ...) -> None: ...

class OtherTaxonomy(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ClassificationConfidence(_message.Message):
    __slots__ = ("confidence", "pending", "confidence_percent")
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    PENDING_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_PERCENT_FIELD_NUMBER: _ClassVar[int]
    confidence: float
    pending: bool
    confidence_percent: int
    def __init__(self, confidence: _Optional[float] = ..., pending: bool = ..., confidence_percent: _Optional[int] = ...) -> None: ...

class PersonTaxonomy(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AnimalTaxonomy(_message.Message):
    __slots__ = ("air", "land")
    AIR_FIELD_NUMBER: _ClassVar[int]
    LAND_FIELD_NUMBER: _ClassVar[int]
    air: AnimalTaxonomyAir
    land: AnimalTaxonomyLand
    def __init__(self, air: _Optional[_Union[AnimalTaxonomyAir, _Mapping]] = ..., land: _Optional[_Union[AnimalTaxonomyLand, _Mapping]] = ...) -> None: ...

class AnimalTaxonomyBird(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AnimalTaxonomyAir(_message.Message):
    __slots__ = ("bird",)
    BIRD_FIELD_NUMBER: _ClassVar[int]
    bird: AnimalTaxonomyBird
    def __init__(self, bird: _Optional[_Union[AnimalTaxonomyBird, _Mapping]] = ...) -> None: ...

class AnimalTaxonomyHorse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AnimalTaxonomyLand(_message.Message):
    __slots__ = ("horse",)
    HORSE_FIELD_NUMBER: _ClassVar[int]
    horse: AnimalTaxonomyHorse
    def __init__(self, horse: _Optional[_Union[AnimalTaxonomyHorse, _Mapping]] = ...) -> None: ...

class InfrastructureTaxonomy(_message.Message):
    __slots__ = ("tower", "bridge", "road", "dam")
    TOWER_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_FIELD_NUMBER: _ClassVar[int]
    ROAD_FIELD_NUMBER: _ClassVar[int]
    DAM_FIELD_NUMBER: _ClassVar[int]
    tower: InfrastructureTaxonomyTower
    bridge: InfrastructureTaxonomyBridge
    road: InfrastructureTaxonomyRoad
    dam: InfrastructureTaxonomyDam
    def __init__(self, tower: _Optional[_Union[InfrastructureTaxonomyTower, _Mapping]] = ..., bridge: _Optional[_Union[InfrastructureTaxonomyBridge, _Mapping]] = ..., road: _Optional[_Union[InfrastructureTaxonomyRoad, _Mapping]] = ..., dam: _Optional[_Union[InfrastructureTaxonomyDam, _Mapping]] = ...) -> None: ...

class InfrastructureTaxonomyTower(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class InfrastructureTaxonomyBridge(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class InfrastructureTaxonomyRoad(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class InfrastructureTaxonomyDam(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomy(_message.Message):
    __slots__ = ("unmanned", "land", "air", "sea", "subsurface")
    UNMANNED_FIELD_NUMBER: _ClassVar[int]
    LAND_FIELD_NUMBER: _ClassVar[int]
    AIR_FIELD_NUMBER: _ClassVar[int]
    SEA_FIELD_NUMBER: _ClassVar[int]
    SUBSURFACE_FIELD_NUMBER: _ClassVar[int]
    unmanned: VehicleTaxonomyUnmanned
    land: VehicleTaxonomyLand
    air: VehicleTaxonomyAir
    sea: VehicleTaxonomySea
    subsurface: VehicleTaxonomySubsurface
    def __init__(self, unmanned: _Optional[_Union[VehicleTaxonomyUnmanned, _Mapping]] = ..., land: _Optional[_Union[VehicleTaxonomyLand, _Mapping]] = ..., air: _Optional[_Union[VehicleTaxonomyAir, _Mapping]] = ..., sea: _Optional[_Union[VehicleTaxonomySea, _Mapping]] = ..., subsurface: _Optional[_Union[VehicleTaxonomySubsurface, _Mapping]] = ...) -> None: ...

class VehicleTaxonomyUnmanned(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyLand(_message.Message):
    __slots__ = ("tracked", "two_wheeled", "multi_wheeled")
    TRACKED_FIELD_NUMBER: _ClassVar[int]
    TWO_WHEELED_FIELD_NUMBER: _ClassVar[int]
    MULTI_WHEELED_FIELD_NUMBER: _ClassVar[int]
    tracked: VehicleTaxonomyTracked
    two_wheeled: VehicleTaxonomyTwoWheeled
    multi_wheeled: VehicleTaxonomyMultiWheeled
    def __init__(self, tracked: _Optional[_Union[VehicleTaxonomyTracked, _Mapping]] = ..., two_wheeled: _Optional[_Union[VehicleTaxonomyTwoWheeled, _Mapping]] = ..., multi_wheeled: _Optional[_Union[VehicleTaxonomyMultiWheeled, _Mapping]] = ...) -> None: ...

class VehicleTaxonomyTracked(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyTwoWheeled(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyMultiWheeled(_message.Message):
    __slots__ = ("light", "medium", "heavy")
    LIGHT_FIELD_NUMBER: _ClassVar[int]
    MEDIUM_FIELD_NUMBER: _ClassVar[int]
    HEAVY_FIELD_NUMBER: _ClassVar[int]
    light: VehicleTaxonomyMultiWheeledLight
    medium: VehicleTaxonomyMultiWheeledMedium
    heavy: VehicleTaxonomyMultiWheeledHeavy
    def __init__(self, light: _Optional[_Union[VehicleTaxonomyMultiWheeledLight, _Mapping]] = ..., medium: _Optional[_Union[VehicleTaxonomyMultiWheeledMedium, _Mapping]] = ..., heavy: _Optional[_Union[VehicleTaxonomyMultiWheeledHeavy, _Mapping]] = ...) -> None: ...

class VehicleTaxonomyMultiWheeledLight(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyMultiWheeledMedium(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyMultiWheeledHeavy(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyAir(_message.Message):
    __slots__ = ("fixed_wing", "lighter_than_air", "rotary")
    FIXED_WING_FIELD_NUMBER: _ClassVar[int]
    LIGHTER_THAN_AIR_FIELD_NUMBER: _ClassVar[int]
    ROTARY_FIELD_NUMBER: _ClassVar[int]
    fixed_wing: VehicleTaxonomyAirFixedWing
    lighter_than_air: VehicleTaxonomyAirLighterThanAir
    rotary: VehicleTaxonomyAirRotary
    def __init__(self, fixed_wing: _Optional[_Union[VehicleTaxonomyAirFixedWing, _Mapping]] = ..., lighter_than_air: _Optional[_Union[VehicleTaxonomyAirLighterThanAir, _Mapping]] = ..., rotary: _Optional[_Union[VehicleTaxonomyAirRotary, _Mapping]] = ...) -> None: ...

class VehicleTaxonomyAirRotary(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyAirFixedWing(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomyAirLighterThanAir(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomySea(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class VehicleTaxonomySubsurface(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomy(_message.Message):
    __slots__ = ("sensor",)
    SENSOR_FIELD_NUMBER: _ClassVar[int]
    sensor: EquipmentTaxonomySensor
    def __init__(self, sensor: _Optional[_Union[EquipmentTaxonomySensor, _Mapping]] = ...) -> None: ...

class EquipmentTaxonomySensor(_message.Message):
    __slots__ = ("emplaced", "radar", "ew", "cbrn", "acoustic", "electro_optical", "seismic")
    EMPLACED_FIELD_NUMBER: _ClassVar[int]
    RADAR_FIELD_NUMBER: _ClassVar[int]
    EW_FIELD_NUMBER: _ClassVar[int]
    CBRN_FIELD_NUMBER: _ClassVar[int]
    ACOUSTIC_FIELD_NUMBER: _ClassVar[int]
    ELECTRO_OPTICAL_FIELD_NUMBER: _ClassVar[int]
    SEISMIC_FIELD_NUMBER: _ClassVar[int]
    emplaced: EquipmentTaxonomySensorEmplaced
    radar: EquipmentTaxonomySensorRadar
    ew: EquipmentTaxonomySensorEW
    cbrn: EquipmentTaxonomySensorCBRN
    acoustic: EquipmentTaxonomySensorAcoustic
    electro_optical: EquipmentTaxonomySensorElectroOptical
    seismic: EquipmentTaxonomySensorSeismic
    def __init__(self, emplaced: _Optional[_Union[EquipmentTaxonomySensorEmplaced, _Mapping]] = ..., radar: _Optional[_Union[EquipmentTaxonomySensorRadar, _Mapping]] = ..., ew: _Optional[_Union[EquipmentTaxonomySensorEW, _Mapping]] = ..., cbrn: _Optional[_Union[EquipmentTaxonomySensorCBRN, _Mapping]] = ..., acoustic: _Optional[_Union[EquipmentTaxonomySensorAcoustic, _Mapping]] = ..., electro_optical: _Optional[_Union[EquipmentTaxonomySensorElectroOptical, _Mapping]] = ..., seismic: _Optional[_Union[EquipmentTaxonomySensorSeismic, _Mapping]] = ...) -> None: ...

class EquipmentTaxonomySensorRadar(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorEW(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorCBRN(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorAcoustic(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorElectroOptical(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorEmplaced(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EquipmentTaxonomySensorSeismic(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EmitterTaxonomy(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomy(_message.Message):
    __slots__ = ("observe", "movement", "effect", "commission", "maintenance", "control")
    OBSERVE_FIELD_NUMBER: _ClassVar[int]
    MOVEMENT_FIELD_NUMBER: _ClassVar[int]
    EFFECT_FIELD_NUMBER: _ClassVar[int]
    COMMISSION_FIELD_NUMBER: _ClassVar[int]
    MAINTENANCE_FIELD_NUMBER: _ClassVar[int]
    CONTROL_FIELD_NUMBER: _ClassVar[int]
    observe: TaskingTaxonomyObserve
    movement: TaskingTaxonomyMovement
    effect: TaskingTaxonomyEffect
    commission: TaskingTaxonomyCommission
    maintenance: TaskingTaxonomyMaintenance
    control: TaskingTaxonomyControl
    def __init__(self, observe: _Optional[_Union[TaskingTaxonomyObserve, _Mapping]] = ..., movement: _Optional[_Union[TaskingTaxonomyMovement, _Mapping]] = ..., effect: _Optional[_Union[TaskingTaxonomyEffect, _Mapping]] = ..., commission: _Optional[_Union[TaskingTaxonomyCommission, _Mapping]] = ..., maintenance: _Optional[_Union[TaskingTaxonomyMaintenance, _Mapping]] = ..., control: _Optional[_Union[TaskingTaxonomyControl, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyMaintenance(_message.Message):
    __slots__ = ("update",)
    UPDATE_FIELD_NUMBER: _ClassVar[int]
    update: TaskingTaxonomyUpdate
    def __init__(self, update: _Optional[_Union[TaskingTaxonomyUpdate, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyControl(_message.Message):
    __slots__ = ("mode_change",)
    MODE_CHANGE_FIELD_NUMBER: _ClassVar[int]
    mode_change: TaskingTaxonomyModeChange
    def __init__(self, mode_change: _Optional[_Union[TaskingTaxonomyModeChange, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyModeChange(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyCommission(_message.Message):
    __slots__ = ("position", "calibrate")
    POSITION_FIELD_NUMBER: _ClassVar[int]
    CALIBRATE_FIELD_NUMBER: _ClassVar[int]
    position: TaskingTaxonomyCommissionPosition
    calibrate: TaskingTaxonomyCommissionCalibrate
    def __init__(self, position: _Optional[_Union[TaskingTaxonomyCommissionPosition, _Mapping]] = ..., calibrate: _Optional[_Union[TaskingTaxonomyCommissionCalibrate, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyObserve(_message.Message):
    __slots__ = ("look_at", "scan", "track")
    LOOK_AT_FIELD_NUMBER: _ClassVar[int]
    SCAN_FIELD_NUMBER: _ClassVar[int]
    TRACK_FIELD_NUMBER: _ClassVar[int]
    look_at: TaskingTaxonomyLookAt
    scan: TaskingTaxonomyScan
    track: TaskingTaxonomyTrack
    def __init__(self, look_at: _Optional[_Union[TaskingTaxonomyLookAt, _Mapping]] = ..., scan: _Optional[_Union[TaskingTaxonomyScan, _Mapping]] = ..., track: _Optional[_Union[TaskingTaxonomyTrack, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyMovement(_message.Message):
    __slots__ = ("move_to", "patrol", "follow")
    MOVE_TO_FIELD_NUMBER: _ClassVar[int]
    PATROL_FIELD_NUMBER: _ClassVar[int]
    FOLLOW_FIELD_NUMBER: _ClassVar[int]
    move_to: TaskingTaxonomyMoveTo
    patrol: TaskingTaxonomyPatrol
    follow: TaskingTaxonomyFollow
    def __init__(self, move_to: _Optional[_Union[TaskingTaxonomyMoveTo, _Mapping]] = ..., patrol: _Optional[_Union[TaskingTaxonomyPatrol, _Mapping]] = ..., follow: _Optional[_Union[TaskingTaxonomyFollow, _Mapping]] = ...) -> None: ...

class TaskingTaxonomyEffect(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyLookAt(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyScan(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyTrack(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyMoveTo(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyPatrol(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyFollow(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyCommissionPosition(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyCommissionCalibrate(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TaskingTaxonomyUpdate(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
