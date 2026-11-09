import geometry_pb2 as _geometry_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
import manualcontrol_pb2 as _manualcontrol_pb2
import metrics_pb2 as _metrics_pb2
import policy_pb2 as _policy_pb2
import software_pb2 as _software_pb2
import tasking_pb2 as _tasking_pb2
import taxonomy_pb2 as _taxonomy_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Priority(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PriorityUnspecified: _ClassVar[Priority]
    PriorityRoutine: _ClassVar[Priority]
    PriorityImmediate: _ClassVar[Priority]
    PriorityFlash: _ClassVar[Priority]

class GnssFixType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    GnssFixTypeNone: _ClassVar[GnssFixType]
    GnssFixType2D: _ClassVar[GnssFixType]
    GnssFixType3D: _ClassVar[GnssFixType]
    GnssFixTypeDGPS: _ClassVar[GnssFixType]
    GnssFixTypeRtkFloat: _ClassVar[GnssFixType]
    GnssFixTypeRtkFixed: _ClassVar[GnssFixType]

class MediaStreamProtocol(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MediaStreamProtocolUnspecified: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolWebrtc: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolHls: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolMjpeg: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolImage: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolIframe: _ClassVar[MediaStreamProtocol]
    MediaStreamProtocolRtsp: _ClassVar[MediaStreamProtocol]

class MediaStreamRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MediaStreamRoleUnspecified: _ClassVar[MediaStreamRole]
    MediaStreamRoleMain: _ClassVar[MediaStreamRole]
    MediaStreamRoleSub: _ClassVar[MediaStreamRole]
    MediaStreamRoleSnapshot: _ClassVar[MediaStreamRole]

class TaskableMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TaskableModeExclusive: _ClassVar[TaskableMode]
    TaskableModeReconcile: _ClassVar[TaskableMode]
    TaskableModeSpawn: _ClassVar[TaskableMode]
    TaskableModePriorityQueue: _ClassVar[TaskableMode]

class TaskExecutionState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TaskExecutionStatePending: _ClassVar[TaskExecutionState]
    TaskExecutionStateRunning: _ClassVar[TaskExecutionState]
    TaskExecutionStateCompleted: _ClassVar[TaskExecutionState]
    TaskExecutionStateFailed: _ClassVar[TaskExecutionState]

class ClassificationIdentity(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ClassificationIdentityInvalid: _ClassVar[ClassificationIdentity]
    ClassificationIdentityPending: _ClassVar[ClassificationIdentity]
    ClassificationIdentityUnknown: _ClassVar[ClassificationIdentity]
    ClassificationIdentityFriend: _ClassVar[ClassificationIdentity]
    ClassificationIdentityNeutral: _ClassVar[ClassificationIdentity]
    ClassificationIdentityHostile: _ClassVar[ClassificationIdentity]
    ClassificationIdentitySuspect: _ClassVar[ClassificationIdentity]

class ClassificationBattleDimension(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ClassificationBattleDimensionInvalid: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionUnknown: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionSpace: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionAir: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionGround: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionSeaSurface: _ClassVar[ClassificationBattleDimension]
    ClassificationBattleDimensionSubsurface: _ClassVar[ClassificationBattleDimension]

class Affiliation(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AffiliationInvalid: _ClassVar[Affiliation]
    AffiliationPending: _ClassVar[Affiliation]
    AffiliationUnknown: _ClassVar[Affiliation]
    AffiliationBlue: _ClassVar[Affiliation]
    AffiliationNeutral: _ClassVar[Affiliation]
    AffiliationRed: _ClassVar[Affiliation]
    AffiliationSuspect: _ClassVar[Affiliation]

class NavigationMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    NavigationModeUnspecified: _ClassVar[NavigationMode]
    NavigationModePlanned: _ClassVar[NavigationMode]
    NavigationModeStationary: _ClassVar[NavigationMode]
    NavigationModeUnderway: _ClassVar[NavigationMode]
    NavigationModeAutonomous: _ClassVar[NavigationMode]
    NavigationModeGuided: _ClassVar[NavigationMode]
    NavigationModeLoitering: _ClassVar[NavigationMode]
    NavigationModeReturning: _ClassVar[NavigationMode]

class LinkStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LinkStatusUnspecified: _ClassVar[LinkStatus]
    LinkStatusConnected: _ClassVar[LinkStatus]
    LinkStatusDegraded: _ClassVar[LinkStatus]
    LinkStatusLost: _ClassVar[LinkStatus]

class DeviceState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DeviceStatePending: _ClassVar[DeviceState]
    DeviceStateActive: _ClassVar[DeviceState]
    DeviceStateFailed: _ClassVar[DeviceState]
    DeviceStateDegraded: _ClassVar[DeviceState]

class ConfigurableState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ConfigurableStateInactive: _ClassVar[ConfigurableState]
    ConfigurableStateStarting: _ClassVar[ConfigurableState]
    ConfigurableStateActive: _ClassVar[ConfigurableState]
    ConfigurableStateFailed: _ClassVar[ConfigurableState]
    ConfigurableStateConflict: _ClassVar[ConfigurableState]
    ConfigurableStateScheduled: _ClassVar[ConfigurableState]

class SortField(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SortFieldUnspecified: _ClassVar[SortField]
    SortFieldLabel: _ClassVar[SortField]
    SortFieldPriority: _ClassVar[SortField]
    SortFieldLifetimeFrom: _ClassVar[SortField]
    SortFieldLifetimeUntil: _ClassVar[SortField]
    SortFieldLifetimeFresh: _ClassVar[SortField]
    SortFieldGeoLatitude: _ClassVar[SortField]
    SortFieldGeoLongitude: _ClassVar[SortField]
    SortFieldGeoAltitude: _ClassVar[SortField]
    SortFieldClassificationIdentity: _ClassVar[SortField]
    SortFieldClassificationDimension: _ClassVar[SortField]
    SortFieldBearingAzimuth: _ClassVar[SortField]
    SortFieldBearingElevation: _ClassVar[SortField]
    SortFieldAdministrativeLength: _ClassVar[SortField]
    SortFieldAdministrativeWidth: _ClassVar[SortField]
    SortFieldAdministrativeHeight: _ClassVar[SortField]
    SortFieldAdministrativeTonnage: _ClassVar[SortField]
    SortFieldAdministrativeEnginePower: _ClassVar[SortField]
    SortFieldAdministrativeYearBuilt: _ClassVar[SortField]
    SortFieldLinkRssi: _ClassVar[SortField]
    SortFieldLinkSnr: _ClassVar[SortField]
    SortFieldLinkLastLatency: _ClassVar[SortField]
    SortFieldLinkAvgLatency: _ClassVar[SortField]
    SortFieldLinkQuality: _ClassVar[SortField]
    SortFieldLinkLastSeen: _ClassVar[SortField]
    SortFieldLinkPacketRate: _ClassVar[SortField]
    SortFieldPowerBatteryCharge: _ClassVar[SortField]
    SortFieldPowerVoltage: _ClassVar[SortField]
    SortFieldPowerRemainingSeconds: _ClassVar[SortField]
    SortFieldPowerCurrent: _ClassVar[SortField]
    SortFieldPowerCapacityUsed: _ClassVar[SortField]
    SortFieldDeviceState: _ClassVar[SortField]
    SortFieldMetricValue: _ClassVar[SortField]
    SortFieldMetricMeasuredAt: _ClassVar[SortField]
    SortFieldMetricAlertLevel: _ClassVar[SortField]

class EntityChange(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EntityChangeInvalid: _ClassVar[EntityChange]
    EntityChangeUpdated: _ClassVar[EntityChange]
    EntityChangeExpired: _ClassVar[EntityChange]
    EntityChangeUnobserved: _ClassVar[EntityChange]
    EntityChangeHeartbeat: _ClassVar[EntityChange]

class EntityComponent(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EntityComponentUnspecified: _ClassVar[EntityComponent]
    EntityComponentLabel: _ClassVar[EntityComponent]
    EntityComponentController: _ClassVar[EntityComponent]
    EntityComponentLifetime: _ClassVar[EntityComponent]
    EntityComponentPriority: _ClassVar[EntityComponent]
    EntityComponentLease: _ClassVar[EntityComponent]
    EntityComponentRouting: _ClassVar[EntityComponent]
    EntityComponentGeo: _ClassVar[EntityComponent]
    EntityComponentSymbol: _ClassVar[EntityComponent]
    EntityComponentCamera: _ClassVar[EntityComponent]
    EntityComponentDetection: _ClassVar[EntityComponent]
    EntityComponentBearing: _ClassVar[EntityComponent]
    EntityComponentTrack: _ClassVar[EntityComponent]
    EntityComponentLocator: _ClassVar[EntityComponent]
    EntityComponentTaskable: _ClassVar[EntityComponent]
    EntityComponentKinematics: _ClassVar[EntityComponent]
    EntityComponentShape: _ClassVar[EntityComponent]
    EntityComponentClassification: _ClassVar[EntityComponent]
    EntityComponentTransponder: _ClassVar[EntityComponent]
    EntityComponentAdministrative: _ClassVar[EntityComponent]
    EntityComponentLocalShape: _ClassVar[EntityComponent]
    EntityComponentOrientation: _ClassVar[EntityComponent]
    EntityComponentMission: _ClassVar[EntityComponent]
    EntityComponentLink: _ClassVar[EntityComponent]
    EntityComponentPower: _ClassVar[EntityComponent]
    EntityComponentNavigation: _ClassVar[EntityComponent]
    EntityComponentCapture: _ClassVar[EntityComponent]
    EntityComponentMetric: _ClassVar[EntityComponent]
    EntityComponentSensor: _ClassVar[EntityComponent]
    EntityComponentPose: _ClassVar[EntityComponent]
    EntityComponentChat: _ClassVar[EntityComponent]
    EntityComponentTaskExecution: _ClassVar[EntityComponent]
    EntityComponentGnss: _ClassVar[EntityComponent]
    EntityComponentDevice: _ClassVar[EntityComponent]
    EntityComponentConfig: _ClassVar[EntityComponent]
    EntityComponentConfigurable: _ClassVar[EntityComponent]
    EntityComponentInteractivity: _ClassVar[EntityComponent]
    EntityComponentArtifact: _ClassVar[EntityComponent]
    EntityComponentTargetPose: _ClassVar[EntityComponent]
    EntityComponentAssembly: _ClassVar[EntityComponent]
    EntityComponentMapLayer: _ClassVar[EntityComponent]
    EntityComponentManualControl: _ClassVar[EntityComponent]
    EntityComponentTargetManualControl: _ClassVar[EntityComponent]
    EntityComponentBounds: _ClassVar[EntityComponent]
    EntityComponentPolicy: _ClassVar[EntityComponent]
    EntityComponentAuthorization: _ClassVar[EntityComponent]
    EntityComponentMeasurement: _ClassVar[EntityComponent]

class TaskStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TaskStatusInvalid: _ClassVar[TaskStatus]
    TaskStatusRunning: _ClassVar[TaskStatus]
    TaskStatusCompleted: _ClassVar[TaskStatus]
    TaskStatusFailed: _ClassVar[TaskStatus]
PriorityUnspecified: Priority
PriorityRoutine: Priority
PriorityImmediate: Priority
PriorityFlash: Priority
GnssFixTypeNone: GnssFixType
GnssFixType2D: GnssFixType
GnssFixType3D: GnssFixType
GnssFixTypeDGPS: GnssFixType
GnssFixTypeRtkFloat: GnssFixType
GnssFixTypeRtkFixed: GnssFixType
MediaStreamProtocolUnspecified: MediaStreamProtocol
MediaStreamProtocolWebrtc: MediaStreamProtocol
MediaStreamProtocolHls: MediaStreamProtocol
MediaStreamProtocolMjpeg: MediaStreamProtocol
MediaStreamProtocolImage: MediaStreamProtocol
MediaStreamProtocolIframe: MediaStreamProtocol
MediaStreamProtocolRtsp: MediaStreamProtocol
MediaStreamRoleUnspecified: MediaStreamRole
MediaStreamRoleMain: MediaStreamRole
MediaStreamRoleSub: MediaStreamRole
MediaStreamRoleSnapshot: MediaStreamRole
TaskableModeExclusive: TaskableMode
TaskableModeReconcile: TaskableMode
TaskableModeSpawn: TaskableMode
TaskableModePriorityQueue: TaskableMode
TaskExecutionStatePending: TaskExecutionState
TaskExecutionStateRunning: TaskExecutionState
TaskExecutionStateCompleted: TaskExecutionState
TaskExecutionStateFailed: TaskExecutionState
ClassificationIdentityInvalid: ClassificationIdentity
ClassificationIdentityPending: ClassificationIdentity
ClassificationIdentityUnknown: ClassificationIdentity
ClassificationIdentityFriend: ClassificationIdentity
ClassificationIdentityNeutral: ClassificationIdentity
ClassificationIdentityHostile: ClassificationIdentity
ClassificationIdentitySuspect: ClassificationIdentity
ClassificationBattleDimensionInvalid: ClassificationBattleDimension
ClassificationBattleDimensionUnknown: ClassificationBattleDimension
ClassificationBattleDimensionSpace: ClassificationBattleDimension
ClassificationBattleDimensionAir: ClassificationBattleDimension
ClassificationBattleDimensionGround: ClassificationBattleDimension
ClassificationBattleDimensionSeaSurface: ClassificationBattleDimension
ClassificationBattleDimensionSubsurface: ClassificationBattleDimension
AffiliationInvalid: Affiliation
AffiliationPending: Affiliation
AffiliationUnknown: Affiliation
AffiliationBlue: Affiliation
AffiliationNeutral: Affiliation
AffiliationRed: Affiliation
AffiliationSuspect: Affiliation
NavigationModeUnspecified: NavigationMode
NavigationModePlanned: NavigationMode
NavigationModeStationary: NavigationMode
NavigationModeUnderway: NavigationMode
NavigationModeAutonomous: NavigationMode
NavigationModeGuided: NavigationMode
NavigationModeLoitering: NavigationMode
NavigationModeReturning: NavigationMode
LinkStatusUnspecified: LinkStatus
LinkStatusConnected: LinkStatus
LinkStatusDegraded: LinkStatus
LinkStatusLost: LinkStatus
DeviceStatePending: DeviceState
DeviceStateActive: DeviceState
DeviceStateFailed: DeviceState
DeviceStateDegraded: DeviceState
ConfigurableStateInactive: ConfigurableState
ConfigurableStateStarting: ConfigurableState
ConfigurableStateActive: ConfigurableState
ConfigurableStateFailed: ConfigurableState
ConfigurableStateConflict: ConfigurableState
ConfigurableStateScheduled: ConfigurableState
SortFieldUnspecified: SortField
SortFieldLabel: SortField
SortFieldPriority: SortField
SortFieldLifetimeFrom: SortField
SortFieldLifetimeUntil: SortField
SortFieldLifetimeFresh: SortField
SortFieldGeoLatitude: SortField
SortFieldGeoLongitude: SortField
SortFieldGeoAltitude: SortField
SortFieldClassificationIdentity: SortField
SortFieldClassificationDimension: SortField
SortFieldBearingAzimuth: SortField
SortFieldBearingElevation: SortField
SortFieldAdministrativeLength: SortField
SortFieldAdministrativeWidth: SortField
SortFieldAdministrativeHeight: SortField
SortFieldAdministrativeTonnage: SortField
SortFieldAdministrativeEnginePower: SortField
SortFieldAdministrativeYearBuilt: SortField
SortFieldLinkRssi: SortField
SortFieldLinkSnr: SortField
SortFieldLinkLastLatency: SortField
SortFieldLinkAvgLatency: SortField
SortFieldLinkQuality: SortField
SortFieldLinkLastSeen: SortField
SortFieldLinkPacketRate: SortField
SortFieldPowerBatteryCharge: SortField
SortFieldPowerVoltage: SortField
SortFieldPowerRemainingSeconds: SortField
SortFieldPowerCurrent: SortField
SortFieldPowerCapacityUsed: SortField
SortFieldDeviceState: SortField
SortFieldMetricValue: SortField
SortFieldMetricMeasuredAt: SortField
SortFieldMetricAlertLevel: SortField
EntityChangeInvalid: EntityChange
EntityChangeUpdated: EntityChange
EntityChangeExpired: EntityChange
EntityChangeUnobserved: EntityChange
EntityChangeHeartbeat: EntityChange
EntityComponentUnspecified: EntityComponent
EntityComponentLabel: EntityComponent
EntityComponentController: EntityComponent
EntityComponentLifetime: EntityComponent
EntityComponentPriority: EntityComponent
EntityComponentLease: EntityComponent
EntityComponentRouting: EntityComponent
EntityComponentGeo: EntityComponent
EntityComponentSymbol: EntityComponent
EntityComponentCamera: EntityComponent
EntityComponentDetection: EntityComponent
EntityComponentBearing: EntityComponent
EntityComponentTrack: EntityComponent
EntityComponentLocator: EntityComponent
EntityComponentTaskable: EntityComponent
EntityComponentKinematics: EntityComponent
EntityComponentShape: EntityComponent
EntityComponentClassification: EntityComponent
EntityComponentTransponder: EntityComponent
EntityComponentAdministrative: EntityComponent
EntityComponentLocalShape: EntityComponent
EntityComponentOrientation: EntityComponent
EntityComponentMission: EntityComponent
EntityComponentLink: EntityComponent
EntityComponentPower: EntityComponent
EntityComponentNavigation: EntityComponent
EntityComponentCapture: EntityComponent
EntityComponentMetric: EntityComponent
EntityComponentSensor: EntityComponent
EntityComponentPose: EntityComponent
EntityComponentChat: EntityComponent
EntityComponentTaskExecution: EntityComponent
EntityComponentGnss: EntityComponent
EntityComponentDevice: EntityComponent
EntityComponentConfig: EntityComponent
EntityComponentConfigurable: EntityComponent
EntityComponentInteractivity: EntityComponent
EntityComponentArtifact: EntityComponent
EntityComponentTargetPose: EntityComponent
EntityComponentAssembly: EntityComponent
EntityComponentMapLayer: EntityComponent
EntityComponentManualControl: EntityComponent
EntityComponentTargetManualControl: EntityComponent
EntityComponentBounds: EntityComponent
EntityComponentPolicy: EntityComponent
EntityComponentAuthorization: EntityComponent
EntityComponentMeasurement: EntityComponent
TaskStatusInvalid: TaskStatus
TaskStatusRunning: TaskStatus
TaskStatusCompleted: TaskStatus
TaskStatusFailed: TaskStatus

class Entity(_message.Message):
    __slots__ = ("id", "label", "controller", "lifetime", "priority", "lease", "routing", "geo", "symbol", "camera", "detection", "bearing", "track", "locator", "kinematics", "shape", "classification", "transponder", "administrative", "orientation", "navigation", "power", "capture", "gnss", "device", "link", "pose", "target_pose", "local_shape", "metric", "config", "configurable", "taskable", "task_execution", "mission", "sensor", "interactivity", "artifact", "chat", "assembly", "map_layer", "manual_control", "target_manual_control", "bounds", "policy", "authorization", "measurement")
    ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CONTROLLER_FIELD_NUMBER: _ClassVar[int]
    LIFETIME_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    LEASE_FIELD_NUMBER: _ClassVar[int]
    ROUTING_FIELD_NUMBER: _ClassVar[int]
    GEO_FIELD_NUMBER: _ClassVar[int]
    SYMBOL_FIELD_NUMBER: _ClassVar[int]
    CAMERA_FIELD_NUMBER: _ClassVar[int]
    DETECTION_FIELD_NUMBER: _ClassVar[int]
    BEARING_FIELD_NUMBER: _ClassVar[int]
    TRACK_FIELD_NUMBER: _ClassVar[int]
    LOCATOR_FIELD_NUMBER: _ClassVar[int]
    KINEMATICS_FIELD_NUMBER: _ClassVar[int]
    SHAPE_FIELD_NUMBER: _ClassVar[int]
    CLASSIFICATION_FIELD_NUMBER: _ClassVar[int]
    TRANSPONDER_FIELD_NUMBER: _ClassVar[int]
    ADMINISTRATIVE_FIELD_NUMBER: _ClassVar[int]
    ORIENTATION_FIELD_NUMBER: _ClassVar[int]
    NAVIGATION_FIELD_NUMBER: _ClassVar[int]
    POWER_FIELD_NUMBER: _ClassVar[int]
    CAPTURE_FIELD_NUMBER: _ClassVar[int]
    GNSS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_FIELD_NUMBER: _ClassVar[int]
    LINK_FIELD_NUMBER: _ClassVar[int]
    POSE_FIELD_NUMBER: _ClassVar[int]
    TARGET_POSE_FIELD_NUMBER: _ClassVar[int]
    LOCAL_SHAPE_FIELD_NUMBER: _ClassVar[int]
    METRIC_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    CONFIGURABLE_FIELD_NUMBER: _ClassVar[int]
    TASKABLE_FIELD_NUMBER: _ClassVar[int]
    TASK_EXECUTION_FIELD_NUMBER: _ClassVar[int]
    MISSION_FIELD_NUMBER: _ClassVar[int]
    SENSOR_FIELD_NUMBER: _ClassVar[int]
    INTERACTIVITY_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    CHAT_FIELD_NUMBER: _ClassVar[int]
    ASSEMBLY_FIELD_NUMBER: _ClassVar[int]
    MAP_LAYER_FIELD_NUMBER: _ClassVar[int]
    MANUAL_CONTROL_FIELD_NUMBER: _ClassVar[int]
    TARGET_MANUAL_CONTROL_FIELD_NUMBER: _ClassVar[int]
    BOUNDS_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_FIELD_NUMBER: _ClassVar[int]
    MEASUREMENT_FIELD_NUMBER: _ClassVar[int]
    id: str
    label: str
    controller: Controller
    lifetime: Lifetime
    priority: Priority
    lease: Lease
    routing: Routing
    geo: GeoSpatialComponent
    symbol: SymbolComponent
    camera: CameraComponent
    detection: DetectionComponent
    bearing: BearingComponent
    track: TrackComponent
    locator: LocatorComponent
    kinematics: KinematicsComponent
    shape: GeoShapeComponent
    classification: ClassificationComponent
    transponder: TransponderComponent
    administrative: AdministrativeComponent
    orientation: OrientationComponent
    navigation: NavigationComponent
    power: PowerComponent
    capture: CaptureComponent
    gnss: GnssComponent
    device: DeviceComponent
    link: LinkComponent
    pose: PoseComponent
    target_pose: TargetPoseComponent
    local_shape: LocalShapeComponent
    metric: _metrics_pb2.MetricComponent
    config: ConfigurationComponent
    configurable: ConfigurableComponent
    taskable: TaskableComponent
    task_execution: TaskExecutionComponent
    mission: MissionComponent
    sensor: SensorComponent
    interactivity: InteractivityComponent
    artifact: ArtifactComponent
    chat: ChatComponent
    assembly: AssemblyComponent
    map_layer: MapLayerComponent
    manual_control: ManualControlComponent
    target_manual_control: TargetManualControlComponent
    bounds: BoundsComponent
    policy: _policy_pb2.PolicyComponent
    authorization: _policy_pb2.AuthorizationComponent
    measurement: MeasurementComponent
    def __init__(self, id: _Optional[str] = ..., label: _Optional[str] = ..., controller: _Optional[_Union[Controller, _Mapping]] = ..., lifetime: _Optional[_Union[Lifetime, _Mapping]] = ..., priority: _Optional[_Union[Priority, str]] = ..., lease: _Optional[_Union[Lease, _Mapping]] = ..., routing: _Optional[_Union[Routing, _Mapping]] = ..., geo: _Optional[_Union[GeoSpatialComponent, _Mapping]] = ..., symbol: _Optional[_Union[SymbolComponent, _Mapping]] = ..., camera: _Optional[_Union[CameraComponent, _Mapping]] = ..., detection: _Optional[_Union[DetectionComponent, _Mapping]] = ..., bearing: _Optional[_Union[BearingComponent, _Mapping]] = ..., track: _Optional[_Union[TrackComponent, _Mapping]] = ..., locator: _Optional[_Union[LocatorComponent, _Mapping]] = ..., kinematics: _Optional[_Union[KinematicsComponent, _Mapping]] = ..., shape: _Optional[_Union[GeoShapeComponent, _Mapping]] = ..., classification: _Optional[_Union[ClassificationComponent, _Mapping]] = ..., transponder: _Optional[_Union[TransponderComponent, _Mapping]] = ..., administrative: _Optional[_Union[AdministrativeComponent, _Mapping]] = ..., orientation: _Optional[_Union[OrientationComponent, _Mapping]] = ..., navigation: _Optional[_Union[NavigationComponent, _Mapping]] = ..., power: _Optional[_Union[PowerComponent, _Mapping]] = ..., capture: _Optional[_Union[CaptureComponent, _Mapping]] = ..., gnss: _Optional[_Union[GnssComponent, _Mapping]] = ..., device: _Optional[_Union[DeviceComponent, _Mapping]] = ..., link: _Optional[_Union[LinkComponent, _Mapping]] = ..., pose: _Optional[_Union[PoseComponent, _Mapping]] = ..., target_pose: _Optional[_Union[TargetPoseComponent, _Mapping]] = ..., local_shape: _Optional[_Union[LocalShapeComponent, _Mapping]] = ..., metric: _Optional[_Union[_metrics_pb2.MetricComponent, _Mapping]] = ..., config: _Optional[_Union[ConfigurationComponent, _Mapping]] = ..., configurable: _Optional[_Union[ConfigurableComponent, _Mapping]] = ..., taskable: _Optional[_Union[TaskableComponent, _Mapping]] = ..., task_execution: _Optional[_Union[TaskExecutionComponent, _Mapping]] = ..., mission: _Optional[_Union[MissionComponent, _Mapping]] = ..., sensor: _Optional[_Union[SensorComponent, _Mapping]] = ..., interactivity: _Optional[_Union[InteractivityComponent, _Mapping]] = ..., artifact: _Optional[_Union[ArtifactComponent, _Mapping]] = ..., chat: _Optional[_Union[ChatComponent, _Mapping]] = ..., assembly: _Optional[_Union[AssemblyComponent, _Mapping]] = ..., map_layer: _Optional[_Union[MapLayerComponent, _Mapping]] = ..., manual_control: _Optional[_Union[ManualControlComponent, _Mapping]] = ..., target_manual_control: _Optional[_Union[TargetManualControlComponent, _Mapping]] = ..., bounds: _Optional[_Union[BoundsComponent, _Mapping]] = ..., policy: _Optional[_Union[_policy_pb2.PolicyComponent, _Mapping]] = ..., authorization: _Optional[_Union[_policy_pb2.AuthorizationComponent, _Mapping]] = ..., measurement: _Optional[_Union[MeasurementComponent, _Mapping]] = ...) -> None: ...

class Controller(_message.Message):
    __slots__ = ("id", "node", "origin")
    ID_FIELD_NUMBER: _ClassVar[int]
    NODE_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    id: str
    node: str
    origin: str
    def __init__(self, id: _Optional[str] = ..., node: _Optional[str] = ..., origin: _Optional[str] = ...) -> None: ...

class Lease(_message.Message):
    __slots__ = ("controller", "expires")
    CONTROLLER_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_FIELD_NUMBER: _ClassVar[int]
    controller: str
    expires: _timestamp_pb2.Timestamp
    def __init__(self, controller: _Optional[str] = ..., expires: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class Lifetime(_message.Message):
    __slots__ = ("until", "fresh")
    FROM_FIELD_NUMBER: _ClassVar[int]
    UNTIL_FIELD_NUMBER: _ClassVar[int]
    FRESH_FIELD_NUMBER: _ClassVar[int]
    until: _timestamp_pb2.Timestamp
    fresh: _timestamp_pb2.Timestamp
    def __init__(self, until: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., fresh: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., **kwargs) -> None: ...

class Channel(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class Routing(_message.Message):
    __slots__ = ("channels",)
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    channels: _containers.RepeatedCompositeFieldContainer[Channel]
    def __init__(self, channels: _Optional[_Iterable[_Union[Channel, _Mapping]]] = ...) -> None: ...

class GeoSpatialComponent(_message.Message):
    __slots__ = ("longitude", "latitude", "altitude", "covariance", "latitude_e7", "longitude_e7", "altitude_cm")
    LONGITUDE_FIELD_NUMBER: _ClassVar[int]
    LATITUDE_FIELD_NUMBER: _ClassVar[int]
    ALTITUDE_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    LATITUDE_E7_FIELD_NUMBER: _ClassVar[int]
    LONGITUDE_E7_FIELD_NUMBER: _ClassVar[int]
    ALTITUDE_CM_FIELD_NUMBER: _ClassVar[int]
    longitude: float
    latitude: float
    altitude: float
    covariance: CovarianceMatrix
    latitude_e7: int
    longitude_e7: int
    altitude_cm: int
    def __init__(self, longitude: _Optional[float] = ..., latitude: _Optional[float] = ..., altitude: _Optional[float] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ..., latitude_e7: _Optional[int] = ..., longitude_e7: _Optional[int] = ..., altitude_cm: _Optional[int] = ...) -> None: ...

class GnssComponent(_message.Message):
    __slots__ = ("fix_type", "satellites_visible", "satellites_used", "hdop", "vdop", "pdop")
    FIX_TYPE_FIELD_NUMBER: _ClassVar[int]
    SATELLITES_VISIBLE_FIELD_NUMBER: _ClassVar[int]
    SATELLITES_USED_FIELD_NUMBER: _ClassVar[int]
    HDOP_FIELD_NUMBER: _ClassVar[int]
    VDOP_FIELD_NUMBER: _ClassVar[int]
    PDOP_FIELD_NUMBER: _ClassVar[int]
    fix_type: GnssFixType
    satellites_visible: int
    satellites_used: int
    hdop: float
    vdop: float
    pdop: float
    def __init__(self, fix_type: _Optional[_Union[GnssFixType, str]] = ..., satellites_visible: _Optional[int] = ..., satellites_used: _Optional[int] = ..., hdop: _Optional[float] = ..., vdop: _Optional[float] = ..., pdop: _Optional[float] = ...) -> None: ...

class SymbolComponent(_message.Message):
    __slots__ = ("milStd2525C",)
    MILSTD2525C_FIELD_NUMBER: _ClassVar[int]
    milStd2525C: str
    def __init__(self, milStd2525C: _Optional[str] = ...) -> None: ...

class InteractivityComponent(_message.Message):
    __slots__ = ("icon", "reference_url")
    ICON_FIELD_NUMBER: _ClassVar[int]
    REFERENCE_URL_FIELD_NUMBER: _ClassVar[int]
    icon: str
    reference_url: str
    def __init__(self, icon: _Optional[str] = ..., reference_url: _Optional[str] = ...) -> None: ...

class MediaStream(_message.Message):
    __slots__ = ("label", "url", "protocol", "role", "codec", "width", "height", "epoch")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CODEC_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    EPOCH_FIELD_NUMBER: _ClassVar[int]
    label: str
    url: str
    protocol: MediaStreamProtocol
    role: MediaStreamRole
    codec: str
    width: int
    height: int
    epoch: _timestamp_pb2.Timestamp
    def __init__(self, label: _Optional[str] = ..., url: _Optional[str] = ..., protocol: _Optional[_Union[MediaStreamProtocol, str]] = ..., role: _Optional[_Union[MediaStreamRole, str]] = ..., codec: _Optional[str] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., epoch: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CameraComponent(_message.Message):
    __slots__ = ("streams", "focal_point", "fov", "range_min", "range_max", "fov_wide", "fov_tele")
    STREAMS_FIELD_NUMBER: _ClassVar[int]
    FOCAL_POINT_FIELD_NUMBER: _ClassVar[int]
    FOV_FIELD_NUMBER: _ClassVar[int]
    RANGE_MIN_FIELD_NUMBER: _ClassVar[int]
    RANGE_MAX_FIELD_NUMBER: _ClassVar[int]
    FOV_WIDE_FIELD_NUMBER: _ClassVar[int]
    FOV_TELE_FIELD_NUMBER: _ClassVar[int]
    streams: _containers.RepeatedCompositeFieldContainer[MediaStream]
    focal_point: str
    fov: float
    range_min: float
    range_max: float
    fov_wide: float
    fov_tele: float
    def __init__(self, streams: _Optional[_Iterable[_Union[MediaStream, _Mapping]]] = ..., focal_point: _Optional[str] = ..., fov: _Optional[float] = ..., range_min: _Optional[float] = ..., range_max: _Optional[float] = ..., fov_wide: _Optional[float] = ..., fov_tele: _Optional[float] = ...) -> None: ...

class ArtifactLocation(_message.Message):
    __slots__ = ("url",)
    URL_FIELD_NUMBER: _ClassVar[int]
    url: str
    def __init__(self, url: _Optional[str] = ...) -> None: ...

class ArtifactEncryption(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ArtifactComponent(_message.Message):
    __slots__ = ("id", "content_type", "location", "size_bytes", "sha256", "encryption", "parts", "software")
    class PartsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: Artifact
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[Artifact, _Mapping]] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    ENCRYPTION_FIELD_NUMBER: _ClassVar[int]
    PARTS_FIELD_NUMBER: _ClassVar[int]
    SOFTWARE_FIELD_NUMBER: _ClassVar[int]
    id: str
    content_type: str
    location: _containers.RepeatedCompositeFieldContainer[ArtifactLocation]
    size_bytes: int
    sha256: str
    encryption: ArtifactEncryption
    parts: _containers.MessageMap[str, Artifact]
    software: _software_pb2.SoftwareArtifact
    def __init__(self, id: _Optional[str] = ..., content_type: _Optional[str] = ..., location: _Optional[_Iterable[_Union[ArtifactLocation, _Mapping]]] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ..., encryption: _Optional[_Union[ArtifactEncryption, _Mapping]] = ..., parts: _Optional[_Mapping[str, Artifact]] = ..., software: _Optional[_Union[_software_pb2.SoftwareArtifact, _Mapping]] = ...) -> None: ...

class Artifact(_message.Message):
    __slots__ = ("content_type", "location", "size_bytes", "sha256")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    content_type: str
    location: _containers.RepeatedCompositeFieldContainer[ArtifactLocation]
    size_bytes: int
    sha256: str
    def __init__(self, content_type: _Optional[str] = ..., location: _Optional[_Iterable[_Union[ArtifactLocation, _Mapping]]] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ...) -> None: ...

class ImageBoundingBox(_message.Message):
    __slots__ = ("x", "y", "width", "height", "frame_width", "frame_height")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    FRAME_WIDTH_FIELD_NUMBER: _ClassVar[int]
    FRAME_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    x: int
    y: int
    width: int
    height: int
    frame_width: int
    frame_height: int
    def __init__(self, x: _Optional[int] = ..., y: _Optional[int] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., frame_width: _Optional[int] = ..., frame_height: _Optional[int] = ...) -> None: ...

class DetectionComponent(_message.Message):
    __slots__ = ("detectorEntityId", "classification", "lastMeasured", "evidence", "image_bbox", "confidence")
    DETECTORENTITYID_FIELD_NUMBER: _ClassVar[int]
    CLASSIFICATION_FIELD_NUMBER: _ClassVar[int]
    LASTMEASURED_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_FIELD_NUMBER: _ClassVar[int]
    IMAGE_BBOX_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    detectorEntityId: str
    classification: str
    lastMeasured: _timestamp_pb2.Timestamp
    evidence: _containers.RepeatedScalarFieldContainer[str]
    image_bbox: ImageBoundingBox
    confidence: float
    def __init__(self, detectorEntityId: _Optional[str] = ..., classification: _Optional[str] = ..., lastMeasured: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., evidence: _Optional[_Iterable[str]] = ..., image_bbox: _Optional[_Union[ImageBoundingBox, _Mapping]] = ..., confidence: _Optional[float] = ...) -> None: ...

class BoundsComponent(_message.Message):
    __slots__ = ("width_m", "height_m", "depth_m", "covariance")
    WIDTH_M_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_M_FIELD_NUMBER: _ClassVar[int]
    DEPTH_M_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    width_m: float
    height_m: float
    depth_m: float
    covariance: CovarianceMatrix
    def __init__(self, width_m: _Optional[float] = ..., height_m: _Optional[float] = ..., depth_m: _Optional[float] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ...) -> None: ...

class BearingComponent(_message.Message):
    __slots__ = ("azimuth", "elevation", "azimuth_extent_deg", "elevation_extent_deg")
    AZIMUTH_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_FIELD_NUMBER: _ClassVar[int]
    AZIMUTH_EXTENT_DEG_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_EXTENT_DEG_FIELD_NUMBER: _ClassVar[int]
    azimuth: float
    elevation: float
    azimuth_extent_deg: float
    elevation_extent_deg: float
    def __init__(self, azimuth: _Optional[float] = ..., elevation: _Optional[float] = ..., azimuth_extent_deg: _Optional[float] = ..., elevation_extent_deg: _Optional[float] = ...) -> None: ...

class SensorComponent(_message.Message):
    __slots__ = ("coverage",)
    COVERAGE_FIELD_NUMBER: _ClassVar[int]
    coverage: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, coverage: _Optional[_Iterable[str]] = ...) -> None: ...

class Quaternion(_message.Message):
    __slots__ = ("x", "y", "z", "w")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    W_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    z: float
    w: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ..., z: _Optional[float] = ..., w: _Optional[float] = ...) -> None: ...

class CovarianceMatrix(_message.Message):
    __slots__ = ("mxx", "mxy", "mxz", "myy", "myz", "mzz")
    MXX_FIELD_NUMBER: _ClassVar[int]
    MXY_FIELD_NUMBER: _ClassVar[int]
    MXZ_FIELD_NUMBER: _ClassVar[int]
    MYY_FIELD_NUMBER: _ClassVar[int]
    MYZ_FIELD_NUMBER: _ClassVar[int]
    MZZ_FIELD_NUMBER: _ClassVar[int]
    mxx: float
    mxy: float
    mxz: float
    myy: float
    myz: float
    mzz: float
    def __init__(self, mxx: _Optional[float] = ..., mxy: _Optional[float] = ..., mxz: _Optional[float] = ..., myy: _Optional[float] = ..., myz: _Optional[float] = ..., mzz: _Optional[float] = ...) -> None: ...

class CartesianOffset(_message.Message):
    __slots__ = ("east_m", "north_m", "up_m", "covariance", "orientation")
    EAST_M_FIELD_NUMBER: _ClassVar[int]
    NORTH_M_FIELD_NUMBER: _ClassVar[int]
    UP_M_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    ORIENTATION_FIELD_NUMBER: _ClassVar[int]
    east_m: float
    north_m: float
    up_m: float
    covariance: CovarianceMatrix
    orientation: Quaternion
    def __init__(self, east_m: _Optional[float] = ..., north_m: _Optional[float] = ..., up_m: _Optional[float] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ..., orientation: _Optional[_Union[Quaternion, _Mapping]] = ...) -> None: ...

class PolarOffset(_message.Message):
    __slots__ = ("azimuth", "elevation", "range", "covariance", "azimuth_error_deg", "elevation_error_deg", "range_error_m", "orientation", "azimuth_cdeg", "azimuth_error_cdeg")
    AZIMUTH_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_FIELD_NUMBER: _ClassVar[int]
    RANGE_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    AZIMUTH_ERROR_DEG_FIELD_NUMBER: _ClassVar[int]
    ELEVATION_ERROR_DEG_FIELD_NUMBER: _ClassVar[int]
    RANGE_ERROR_M_FIELD_NUMBER: _ClassVar[int]
    ORIENTATION_FIELD_NUMBER: _ClassVar[int]
    AZIMUTH_CDEG_FIELD_NUMBER: _ClassVar[int]
    AZIMUTH_ERROR_CDEG_FIELD_NUMBER: _ClassVar[int]
    azimuth: float
    elevation: float
    range: float
    covariance: CovarianceMatrix
    azimuth_error_deg: float
    elevation_error_deg: float
    range_error_m: float
    orientation: Quaternion
    azimuth_cdeg: int
    azimuth_error_cdeg: int
    def __init__(self, azimuth: _Optional[float] = ..., elevation: _Optional[float] = ..., range: _Optional[float] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ..., azimuth_error_deg: _Optional[float] = ..., elevation_error_deg: _Optional[float] = ..., range_error_m: _Optional[float] = ..., orientation: _Optional[_Union[Quaternion, _Mapping]] = ..., azimuth_cdeg: _Optional[int] = ..., azimuth_error_cdeg: _Optional[int] = ...) -> None: ...

class PoseComponent(_message.Message):
    __slots__ = ("parent", "cartesian", "polar")
    PARENT_FIELD_NUMBER: _ClassVar[int]
    CARTESIAN_FIELD_NUMBER: _ClassVar[int]
    POLAR_FIELD_NUMBER: _ClassVar[int]
    parent: str
    cartesian: CartesianOffset
    polar: PolarOffset
    def __init__(self, parent: _Optional[str] = ..., cartesian: _Optional[_Union[CartesianOffset, _Mapping]] = ..., polar: _Optional[_Union[PolarOffset, _Mapping]] = ...) -> None: ...

class TargetPoseComponent(_message.Message):
    __slots__ = ("cartesian", "polar")
    CARTESIAN_FIELD_NUMBER: _ClassVar[int]
    POLAR_FIELD_NUMBER: _ClassVar[int]
    cartesian: CartesianOffset
    polar: PolarOffset
    def __init__(self, cartesian: _Optional[_Union[CartesianOffset, _Mapping]] = ..., polar: _Optional[_Union[PolarOffset, _Mapping]] = ...) -> None: ...

class AngularVelocity(_message.Message):
    __slots__ = ("roll_rate", "pitch_rate", "yaw_rate")
    ROLL_RATE_FIELD_NUMBER: _ClassVar[int]
    PITCH_RATE_FIELD_NUMBER: _ClassVar[int]
    YAW_RATE_FIELD_NUMBER: _ClassVar[int]
    roll_rate: float
    pitch_rate: float
    yaw_rate: float
    def __init__(self, roll_rate: _Optional[float] = ..., pitch_rate: _Optional[float] = ..., yaw_rate: _Optional[float] = ...) -> None: ...

class OrientationComponent(_message.Message):
    __slots__ = ("orientation", "covariance")
    ORIENTATION_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    orientation: Quaternion
    covariance: CovarianceMatrix
    def __init__(self, orientation: _Optional[_Union[Quaternion, _Mapping]] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ...) -> None: ...

class TrackComponent(_message.Message):
    __slots__ = ("tracker", "history", "prediction", "evidence", "confidence")
    TRACKER_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    PREDICTION_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    tracker: str
    history: str
    prediction: str
    evidence: _containers.RepeatedScalarFieldContainer[str]
    confidence: float
    def __init__(self, tracker: _Optional[str] = ..., history: _Optional[str] = ..., prediction: _Optional[str] = ..., evidence: _Optional[_Iterable[str]] = ..., confidence: _Optional[float] = ...) -> None: ...

class LocatorComponent(_message.Message):
    __slots__ = ("locatedEntityId",)
    LOCATEDENTITYID_FIELD_NUMBER: _ClassVar[int]
    locatedEntityId: str
    def __init__(self, locatedEntityId: _Optional[str] = ...) -> None: ...

class TaskableContext(_message.Message):
    __slots__ = ("entityId",)
    ENTITYID_FIELD_NUMBER: _ClassVar[int]
    entityId: str
    def __init__(self, entityId: _Optional[str] = ...) -> None: ...

class TaskableAssignee(_message.Message):
    __slots__ = ("entityId",)
    ENTITYID_FIELD_NUMBER: _ClassVar[int]
    entityId: str
    def __init__(self, entityId: _Optional[str] = ...) -> None: ...

class TaskableComponent(_message.Message):
    __slots__ = ("priority", "label", "context", "assignee", "schema", "mode", "target", "icon", "effect", "grouping", "grouping_priority", "taxonomy", "disabled", "max_executions")
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    EFFECT_FIELD_NUMBER: _ClassVar[int]
    GROUPING_FIELD_NUMBER: _ClassVar[int]
    GROUPING_PRIORITY_FIELD_NUMBER: _ClassVar[int]
    TAXONOMY_FIELD_NUMBER: _ClassVar[int]
    DISABLED_FIELD_NUMBER: _ClassVar[int]
    MAX_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    priority: int
    label: str
    context: _containers.RepeatedCompositeFieldContainer[TaskableContext]
    assignee: _containers.RepeatedCompositeFieldContainer[TaskableAssignee]
    schema: _struct_pb2.Struct
    mode: TaskableMode
    target: _tasking_pb2.TaskableTarget
    icon: str
    effect: str
    grouping: str
    grouping_priority: int
    taxonomy: _taxonomy_pb2.TaskingTaxonomy
    disabled: str
    max_executions: int
    def __init__(self, priority: _Optional[int] = ..., label: _Optional[str] = ..., context: _Optional[_Iterable[_Union[TaskableContext, _Mapping]]] = ..., assignee: _Optional[_Iterable[_Union[TaskableAssignee, _Mapping]]] = ..., schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., mode: _Optional[_Union[TaskableMode, str]] = ..., target: _Optional[_Union[_tasking_pb2.TaskableTarget, _Mapping]] = ..., icon: _Optional[str] = ..., effect: _Optional[str] = ..., grouping: _Optional[str] = ..., grouping_priority: _Optional[int] = ..., taxonomy: _Optional[_Union[_taxonomy_pb2.TaskingTaxonomy, _Mapping]] = ..., disabled: _Optional[str] = ..., max_executions: _Optional[int] = ...) -> None: ...

class TaskExecutionComponent(_message.Message):
    __slots__ = ("task", "parameters", "state", "reason", "priority", "target", "eta", "progress")
    TASK_FIELD_NUMBER: _ClassVar[int]
    PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    ETA_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    task: str
    parameters: _struct_pb2.Struct
    state: TaskExecutionState
    reason: str
    priority: int
    target: _tasking_pb2.TaskExecutionTarget
    eta: _timestamp_pb2.Timestamp
    progress: int
    def __init__(self, task: _Optional[str] = ..., parameters: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., state: _Optional[_Union[TaskExecutionState, str]] = ..., reason: _Optional[str] = ..., priority: _Optional[int] = ..., target: _Optional[_Union[_tasking_pb2.TaskExecutionTarget, _Mapping]] = ..., eta: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., progress: _Optional[int] = ...) -> None: ...

class KinematicsEnu(_message.Message):
    __slots__ = ("east", "north", "up", "covariance")
    EAST_FIELD_NUMBER: _ClassVar[int]
    NORTH_FIELD_NUMBER: _ClassVar[int]
    UP_FIELD_NUMBER: _ClassVar[int]
    COVARIANCE_FIELD_NUMBER: _ClassVar[int]
    east: float
    north: float
    up: float
    covariance: CovarianceMatrix
    def __init__(self, east: _Optional[float] = ..., north: _Optional[float] = ..., up: _Optional[float] = ..., covariance: _Optional[_Union[CovarianceMatrix, _Mapping]] = ...) -> None: ...

class KinematicsComponent(_message.Message):
    __slots__ = ("velocityEnu", "accelerationEnu", "angularVelocityBody")
    VELOCITYENU_FIELD_NUMBER: _ClassVar[int]
    ACCELERATIONENU_FIELD_NUMBER: _ClassVar[int]
    ANGULARVELOCITYBODY_FIELD_NUMBER: _ClassVar[int]
    velocityEnu: KinematicsEnu
    accelerationEnu: KinematicsEnu
    angularVelocityBody: AngularVelocity
    def __init__(self, velocityEnu: _Optional[_Union[KinematicsEnu, _Mapping]] = ..., accelerationEnu: _Optional[_Union[KinematicsEnu, _Mapping]] = ..., angularVelocityBody: _Optional[_Union[AngularVelocity, _Mapping]] = ...) -> None: ...

class Geometry(_message.Message):
    __slots__ = ("wkb", "planar")
    WKB_FIELD_NUMBER: _ClassVar[int]
    PLANAR_FIELD_NUMBER: _ClassVar[int]
    wkb: bytes
    planar: _geometry_pb2.PlanarGeometry
    def __init__(self, wkb: _Optional[bytes] = ..., planar: _Optional[_Union[_geometry_pb2.PlanarGeometry, _Mapping]] = ...) -> None: ...

class GeoShapeComponent(_message.Message):
    __slots__ = ("geometry", "extrusion")
    GEOMETRY_FIELD_NUMBER: _ClassVar[int]
    EXTRUSION_FIELD_NUMBER: _ClassVar[int]
    geometry: Geometry
    extrusion: _geometry_pb2.GeometryExtrusion
    def __init__(self, geometry: _Optional[_Union[Geometry, _Mapping]] = ..., extrusion: _Optional[_Union[_geometry_pb2.GeometryExtrusion, _Mapping]] = ...) -> None: ...

class LocalShapeComponent(_message.Message):
    __slots__ = ("relative_to", "geometry", "extrusion")
    RELATIVE_TO_FIELD_NUMBER: _ClassVar[int]
    GEOMETRY_FIELD_NUMBER: _ClassVar[int]
    EXTRUSION_FIELD_NUMBER: _ClassVar[int]
    relative_to: str
    geometry: _geometry_pb2.LocalGeometry
    extrusion: _geometry_pb2.GeometryExtrusion
    def __init__(self, relative_to: _Optional[str] = ..., geometry: _Optional[_Union[_geometry_pb2.LocalGeometry, _Mapping]] = ..., extrusion: _Optional[_Union[_geometry_pb2.GeometryExtrusion, _Mapping]] = ...) -> None: ...

class MeasurementComponent(_message.Message):
    __slots__ = ("vertex",)
    VERTEX_FIELD_NUMBER: _ClassVar[int]
    vertex: _containers.RepeatedCompositeFieldContainer[MeasurementVertex]
    def __init__(self, vertex: _Optional[_Iterable[_Union[MeasurementVertex, _Mapping]]] = ...) -> None: ...

class MeasurementVertex(_message.Message):
    __slots__ = ("point", "entity")
    POINT_FIELD_NUMBER: _ClassVar[int]
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    point: _geometry_pb2.PlanarPoint
    entity: str
    def __init__(self, point: _Optional[_Union[_geometry_pb2.PlanarPoint, _Mapping]] = ..., entity: _Optional[str] = ...) -> None: ...

class ClassificationComponent(_message.Message):
    __slots__ = ("dimension", "identity", "taxonomy")
    DIMENSION_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_FIELD_NUMBER: _ClassVar[int]
    TAXONOMY_FIELD_NUMBER: _ClassVar[int]
    dimension: ClassificationBattleDimension
    identity: ClassificationIdentity
    taxonomy: _containers.RepeatedCompositeFieldContainer[_taxonomy_pb2.ClassificationTaxonomy]
    def __init__(self, dimension: _Optional[_Union[ClassificationBattleDimension, str]] = ..., identity: _Optional[_Union[ClassificationIdentity, str]] = ..., taxonomy: _Optional[_Iterable[_Union[_taxonomy_pb2.ClassificationTaxonomy, _Mapping]]] = ...) -> None: ...

class IdentityComponent(_message.Message):
    __slots__ = ("affiliation",)
    AFFILIATION_FIELD_NUMBER: _ClassVar[int]
    affiliation: Affiliation
    def __init__(self, affiliation: _Optional[_Union[Affiliation, str]] = ...) -> None: ...

class TransponderAIS(_message.Message):
    __slots__ = ("mmsi", "imo", "callsign", "vessel_name", "dimension_to_bow_m", "dimension_to_stern_m", "dimension_to_port_m", "dimension_to_starboard_m")
    MMSI_FIELD_NUMBER: _ClassVar[int]
    IMO_FIELD_NUMBER: _ClassVar[int]
    CALLSIGN_FIELD_NUMBER: _ClassVar[int]
    VESSEL_NAME_FIELD_NUMBER: _ClassVar[int]
    DIMENSION_TO_BOW_M_FIELD_NUMBER: _ClassVar[int]
    DIMENSION_TO_STERN_M_FIELD_NUMBER: _ClassVar[int]
    DIMENSION_TO_PORT_M_FIELD_NUMBER: _ClassVar[int]
    DIMENSION_TO_STARBOARD_M_FIELD_NUMBER: _ClassVar[int]
    mmsi: int
    imo: int
    callsign: str
    vessel_name: str
    dimension_to_bow_m: int
    dimension_to_stern_m: int
    dimension_to_port_m: int
    dimension_to_starboard_m: int
    def __init__(self, mmsi: _Optional[int] = ..., imo: _Optional[int] = ..., callsign: _Optional[str] = ..., vessel_name: _Optional[str] = ..., dimension_to_bow_m: _Optional[int] = ..., dimension_to_stern_m: _Optional[int] = ..., dimension_to_port_m: _Optional[int] = ..., dimension_to_starboard_m: _Optional[int] = ...) -> None: ...

class TransponderADSB(_message.Message):
    __slots__ = ("icao_address", "flight_id")
    ICAO_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    FLIGHT_ID_FIELD_NUMBER: _ClassVar[int]
    icao_address: int
    flight_id: str
    def __init__(self, icao_address: _Optional[int] = ..., flight_id: _Optional[str] = ...) -> None: ...

class TransponderComponent(_message.Message):
    __slots__ = ("ais", "adsb")
    AIS_FIELD_NUMBER: _ClassVar[int]
    ADSB_FIELD_NUMBER: _ClassVar[int]
    ais: TransponderAIS
    adsb: TransponderADSB
    def __init__(self, ais: _Optional[_Union[TransponderAIS, _Mapping]] = ..., adsb: _Optional[_Union[TransponderADSB, _Mapping]] = ...) -> None: ...

class AdministrativeComponent(_message.Message):
    __slots__ = ("id", "flag", "owner", "operator", "manufacturer", "model", "part_number", "serial_number", "hardware_revision", "year_built", "length_m", "width_m", "height_m", "draught_m", "tonnage_gt", "deadweight_t", "engine_power_kw", "speed_max_kn", "images")
    ID_FIELD_NUMBER: _ClassVar[int]
    FLAG_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    MANUFACTURER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PART_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SERIAL_NUMBER_FIELD_NUMBER: _ClassVar[int]
    HARDWARE_REVISION_FIELD_NUMBER: _ClassVar[int]
    YEAR_BUILT_FIELD_NUMBER: _ClassVar[int]
    LENGTH_M_FIELD_NUMBER: _ClassVar[int]
    WIDTH_M_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_M_FIELD_NUMBER: _ClassVar[int]
    DRAUGHT_M_FIELD_NUMBER: _ClassVar[int]
    TONNAGE_GT_FIELD_NUMBER: _ClassVar[int]
    DEADWEIGHT_T_FIELD_NUMBER: _ClassVar[int]
    ENGINE_POWER_KW_FIELD_NUMBER: _ClassVar[int]
    SPEED_MAX_KN_FIELD_NUMBER: _ClassVar[int]
    IMAGES_FIELD_NUMBER: _ClassVar[int]
    id: str
    flag: str
    owner: str
    operator: str
    manufacturer: str
    model: str
    part_number: str
    serial_number: str
    hardware_revision: str
    year_built: int
    length_m: float
    width_m: float
    height_m: float
    draught_m: float
    tonnage_gt: float
    deadweight_t: float
    engine_power_kw: float
    speed_max_kn: float
    images: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., flag: _Optional[str] = ..., owner: _Optional[str] = ..., operator: _Optional[str] = ..., manufacturer: _Optional[str] = ..., model: _Optional[str] = ..., part_number: _Optional[str] = ..., serial_number: _Optional[str] = ..., hardware_revision: _Optional[str] = ..., year_built: _Optional[int] = ..., length_m: _Optional[float] = ..., width_m: _Optional[float] = ..., height_m: _Optional[float] = ..., draught_m: _Optional[float] = ..., tonnage_gt: _Optional[float] = ..., deadweight_t: _Optional[float] = ..., engine_power_kw: _Optional[float] = ..., speed_max_kn: _Optional[float] = ..., images: _Optional[_Iterable[str]] = ...) -> None: ...

class NavigationComponent(_message.Message):
    __slots__ = ("mode", "armed", "emergency", "waypoint_current", "waypoint_total")
    MODE_FIELD_NUMBER: _ClassVar[int]
    ARMED_FIELD_NUMBER: _ClassVar[int]
    EMERGENCY_FIELD_NUMBER: _ClassVar[int]
    WAYPOINT_CURRENT_FIELD_NUMBER: _ClassVar[int]
    WAYPOINT_TOTAL_FIELD_NUMBER: _ClassVar[int]
    mode: NavigationMode
    armed: bool
    emergency: bool
    waypoint_current: int
    waypoint_total: int
    def __init__(self, mode: _Optional[_Union[NavigationMode, str]] = ..., armed: bool = ..., emergency: bool = ..., waypoint_current: _Optional[int] = ..., waypoint_total: _Optional[int] = ...) -> None: ...

class MissionComponent(_message.Message):
    __slots__ = ("members", "description", "destination", "eta")
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DESTINATION_FIELD_NUMBER: _ClassVar[int]
    ETA_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedScalarFieldContainer[str]
    description: str
    destination: str
    eta: _timestamp_pb2.Timestamp
    def __init__(self, members: _Optional[_Iterable[str]] = ..., description: _Optional[str] = ..., destination: _Optional[str] = ..., eta: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class LinkComponent(_message.Message):
    __slots__ = ("status", "rssi_dbm", "snr_db", "via", "last_latency_ms", "avg_latency_ms", "last_seen", "link_quality_percent", "tx_power_mw", "active_antenna", "rf_mode", "packet_rate_hz")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    RSSI_DBM_FIELD_NUMBER: _ClassVar[int]
    SNR_DB_FIELD_NUMBER: _ClassVar[int]
    VIA_FIELD_NUMBER: _ClassVar[int]
    LAST_LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    AVG_LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    LAST_SEEN_FIELD_NUMBER: _ClassVar[int]
    LINK_QUALITY_PERCENT_FIELD_NUMBER: _ClassVar[int]
    TX_POWER_MW_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_ANTENNA_FIELD_NUMBER: _ClassVar[int]
    RF_MODE_FIELD_NUMBER: _ClassVar[int]
    PACKET_RATE_HZ_FIELD_NUMBER: _ClassVar[int]
    status: LinkStatus
    rssi_dbm: int
    snr_db: int
    via: str
    last_latency_ms: int
    avg_latency_ms: int
    last_seen: _timestamp_pb2.Timestamp
    link_quality_percent: int
    tx_power_mw: int
    active_antenna: int
    rf_mode: str
    packet_rate_hz: int
    def __init__(self, status: _Optional[_Union[LinkStatus, str]] = ..., rssi_dbm: _Optional[int] = ..., snr_db: _Optional[int] = ..., via: _Optional[str] = ..., last_latency_ms: _Optional[int] = ..., avg_latency_ms: _Optional[int] = ..., last_seen: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., link_quality_percent: _Optional[int] = ..., tx_power_mw: _Optional[int] = ..., active_antenna: _Optional[int] = ..., rf_mode: _Optional[str] = ..., packet_rate_hz: _Optional[int] = ...) -> None: ...

class CaptureComponent(_message.Message):
    __slots__ = ("payload", "port", "content_type", "captured_by", "captured_at", "content")
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    PORT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CAPTURED_BY_FIELD_NUMBER: _ClassVar[int]
    CAPTURED_AT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    payload: bytes
    port: int
    content_type: str
    captured_by: str
    captured_at: _timestamp_pb2.Timestamp
    content: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, payload: _Optional[bytes] = ..., port: _Optional[int] = ..., content_type: _Optional[str] = ..., captured_by: _Optional[str] = ..., captured_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., content: _Optional[_Iterable[str]] = ...) -> None: ...

class CaptureFilter(_message.Message):
    __slots__ = ("port", "content_type", "captured_by")
    PORT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CAPTURED_BY_FIELD_NUMBER: _ClassVar[int]
    port: int
    content_type: str
    captured_by: str
    def __init__(self, port: _Optional[int] = ..., content_type: _Optional[str] = ..., captured_by: _Optional[str] = ...) -> None: ...

class PowerComponent(_message.Message):
    __slots__ = ("battery_charge_remaining", "voltage", "remaining_seconds", "current_a", "capacity_used_mah", "battery_charge_percent")
    BATTERY_CHARGE_REMAINING_FIELD_NUMBER: _ClassVar[int]
    VOLTAGE_FIELD_NUMBER: _ClassVar[int]
    REMAINING_SECONDS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_A_FIELD_NUMBER: _ClassVar[int]
    CAPACITY_USED_MAH_FIELD_NUMBER: _ClassVar[int]
    BATTERY_CHARGE_PERCENT_FIELD_NUMBER: _ClassVar[int]
    battery_charge_remaining: float
    voltage: float
    remaining_seconds: int
    current_a: float
    capacity_used_mah: float
    battery_charge_percent: int
    def __init__(self, battery_charge_remaining: _Optional[float] = ..., voltage: _Optional[float] = ..., remaining_seconds: _Optional[int] = ..., current_a: _Optional[float] = ..., capacity_used_mah: _Optional[float] = ..., battery_charge_percent: _Optional[int] = ...) -> None: ...

class DeviceClassOption(_message.Message):
    __slots__ = ("label", "description")
    CLASS_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    label: str
    description: str
    def __init__(self, label: _Optional[str] = ..., description: _Optional[str] = ..., **kwargs) -> None: ...

class ConfigurableComponent(_message.Message):
    __slots__ = ("schema", "value", "state", "error", "label", "applied_version", "supported_device_classes", "scheduled_at")
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    APPLIED_VERSION_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_DEVICE_CLASSES_FIELD_NUMBER: _ClassVar[int]
    SCHEDULED_AT_FIELD_NUMBER: _ClassVar[int]
    schema: _struct_pb2.Struct
    value: _struct_pb2.Struct
    state: ConfigurableState
    error: str
    label: str
    applied_version: int
    supported_device_classes: _containers.RepeatedCompositeFieldContainer[DeviceClassOption]
    scheduled_at: _timestamp_pb2.Timestamp
    def __init__(self, schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., value: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., state: _Optional[_Union[ConfigurableState, str]] = ..., error: _Optional[str] = ..., label: _Optional[str] = ..., applied_version: _Optional[int] = ..., supported_device_classes: _Optional[_Iterable[_Union[DeviceClassOption, _Mapping]]] = ..., scheduled_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class DeviceComponent(_message.Message):
    __slots__ = ("parent", "composition", "unique_hardware_id", "unique_hardware_index", "state", "error", "category", "node", "usb", "ip", "serial", "ethernet", "lpwan", "meshtastic", "ble", "software")
    PARENT_FIELD_NUMBER: _ClassVar[int]
    COMPOSITION_FIELD_NUMBER: _ClassVar[int]
    UNIQUE_HARDWARE_ID_FIELD_NUMBER: _ClassVar[int]
    UNIQUE_HARDWARE_INDEX_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    CLASS_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    NODE_FIELD_NUMBER: _ClassVar[int]
    USB_FIELD_NUMBER: _ClassVar[int]
    IP_FIELD_NUMBER: _ClassVar[int]
    SERIAL_FIELD_NUMBER: _ClassVar[int]
    ETHERNET_FIELD_NUMBER: _ClassVar[int]
    LPWAN_FIELD_NUMBER: _ClassVar[int]
    MESHTASTIC_FIELD_NUMBER: _ClassVar[int]
    BLE_FIELD_NUMBER: _ClassVar[int]
    SOFTWARE_FIELD_NUMBER: _ClassVar[int]
    parent: str
    composition: _containers.RepeatedScalarFieldContainer[str]
    unique_hardware_id: str
    unique_hardware_index: int
    state: DeviceState
    error: str
    category: str
    node: NodeDevice
    usb: UsbDevice
    ip: IpDevice
    serial: SerialDevice
    ethernet: EthernetDevice
    lpwan: LPWANDevice
    meshtastic: MeshtasticDevice
    ble: BleDevice
    software: _software_pb2.DeviceSoftware
    def __init__(self, parent: _Optional[str] = ..., composition: _Optional[_Iterable[str]] = ..., unique_hardware_id: _Optional[str] = ..., unique_hardware_index: _Optional[int] = ..., state: _Optional[_Union[DeviceState, str]] = ..., error: _Optional[str] = ..., category: _Optional[str] = ..., node: _Optional[_Union[NodeDevice, _Mapping]] = ..., usb: _Optional[_Union[UsbDevice, _Mapping]] = ..., ip: _Optional[_Union[IpDevice, _Mapping]] = ..., serial: _Optional[_Union[SerialDevice, _Mapping]] = ..., ethernet: _Optional[_Union[EthernetDevice, _Mapping]] = ..., lpwan: _Optional[_Union[LPWANDevice, _Mapping]] = ..., meshtastic: _Optional[_Union[MeshtasticDevice, _Mapping]] = ..., ble: _Optional[_Union[BleDevice, _Mapping]] = ..., software: _Optional[_Union[_software_pb2.DeviceSoftware, _Mapping]] = ..., **kwargs) -> None: ...

class MissionPack(_message.Message):
    __slots__ = ("layouts", "entity_count", "pack_version", "imported_at", "artifact_count", "artifact_total_size")
    class LayoutsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    LAYOUTS_FIELD_NUMBER: _ClassVar[int]
    ENTITY_COUNT_FIELD_NUMBER: _ClassVar[int]
    PACK_VERSION_FIELD_NUMBER: _ClassVar[int]
    IMPORTED_AT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_COUNT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_TOTAL_SIZE_FIELD_NUMBER: _ClassVar[int]
    layouts: _containers.ScalarMap[str, str]
    entity_count: int
    pack_version: str
    imported_at: _timestamp_pb2.Timestamp
    artifact_count: int
    artifact_total_size: int
    def __init__(self, layouts: _Optional[_Mapping[str, str]] = ..., entity_count: _Optional[int] = ..., pack_version: _Optional[str] = ..., imported_at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., artifact_count: _Optional[int] = ..., artifact_total_size: _Optional[int] = ...) -> None: ...

class NodeDevice(_message.Message):
    __slots__ = ("hostname", "os", "arch", "num_cpu", "os_version", "hydris_version", "hydris_update_available", "mission", "mtls_identity")
    HOSTNAME_FIELD_NUMBER: _ClassVar[int]
    OS_FIELD_NUMBER: _ClassVar[int]
    ARCH_FIELD_NUMBER: _ClassVar[int]
    NUM_CPU_FIELD_NUMBER: _ClassVar[int]
    OS_VERSION_FIELD_NUMBER: _ClassVar[int]
    HYDRIS_VERSION_FIELD_NUMBER: _ClassVar[int]
    HYDRIS_UPDATE_AVAILABLE_FIELD_NUMBER: _ClassVar[int]
    MISSION_FIELD_NUMBER: _ClassVar[int]
    MTLS_IDENTITY_FIELD_NUMBER: _ClassVar[int]
    hostname: str
    os: str
    arch: str
    num_cpu: int
    os_version: str
    hydris_version: str
    hydris_update_available: str
    mission: MissionPack
    mtls_identity: str
    def __init__(self, hostname: _Optional[str] = ..., os: _Optional[str] = ..., arch: _Optional[str] = ..., num_cpu: _Optional[int] = ..., os_version: _Optional[str] = ..., hydris_version: _Optional[str] = ..., hydris_update_available: _Optional[str] = ..., mission: _Optional[_Union[MissionPack, _Mapping]] = ..., mtls_identity: _Optional[str] = ...) -> None: ...

class UsbDevice(_message.Message):
    __slots__ = ("vendor_id", "product_id", "device_class", "device_subclass", "device_protocol", "manufacturer_name", "product_name", "serial_number")
    VENDOR_ID_FIELD_NUMBER: _ClassVar[int]
    PRODUCT_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_CLASS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_SUBCLASS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    MANUFACTURER_NAME_FIELD_NUMBER: _ClassVar[int]
    PRODUCT_NAME_FIELD_NUMBER: _ClassVar[int]
    SERIAL_NUMBER_FIELD_NUMBER: _ClassVar[int]
    vendor_id: int
    product_id: int
    device_class: int
    device_subclass: int
    device_protocol: int
    manufacturer_name: str
    product_name: str
    serial_number: str
    def __init__(self, vendor_id: _Optional[int] = ..., product_id: _Optional[int] = ..., device_class: _Optional[int] = ..., device_subclass: _Optional[int] = ..., device_protocol: _Optional[int] = ..., manufacturer_name: _Optional[str] = ..., product_name: _Optional[str] = ..., serial_number: _Optional[str] = ...) -> None: ...

class IpDevice(_message.Message):
    __slots__ = ("host", "port")
    HOST_FIELD_NUMBER: _ClassVar[int]
    PORT_FIELD_NUMBER: _ClassVar[int]
    host: str
    port: int
    def __init__(self, host: _Optional[str] = ..., port: _Optional[int] = ...) -> None: ...

class EthernetDevice(_message.Message):
    __slots__ = ("mac_address", "vendor")
    MAC_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    VENDOR_FIELD_NUMBER: _ClassVar[int]
    mac_address: str
    vendor: str
    def __init__(self, mac_address: _Optional[str] = ..., vendor: _Optional[str] = ...) -> None: ...

class SerialDevice(_message.Message):
    __slots__ = ("path", "baud_rate")
    PATH_FIELD_NUMBER: _ClassVar[int]
    BAUD_RATE_FIELD_NUMBER: _ClassVar[int]
    path: str
    baud_rate: int
    def __init__(self, path: _Optional[str] = ..., baud_rate: _Optional[int] = ...) -> None: ...

class MeshtasticDevice(_message.Message):
    __slots__ = ("node_num", "long_name", "short_name", "hardware_model", "public_key")
    NODE_NUM_FIELD_NUMBER: _ClassVar[int]
    LONG_NAME_FIELD_NUMBER: _ClassVar[int]
    SHORT_NAME_FIELD_NUMBER: _ClassVar[int]
    HARDWARE_MODEL_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    node_num: int
    long_name: str
    short_name: str
    hardware_model: str
    public_key: bytes
    def __init__(self, node_num: _Optional[int] = ..., long_name: _Optional[str] = ..., short_name: _Optional[str] = ..., hardware_model: _Optional[str] = ..., public_key: _Optional[bytes] = ...) -> None: ...

class LPWANDevice(_message.Message):
    __slots__ = ("eui", "address")
    EUI_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    eui: str
    address: str
    def __init__(self, eui: _Optional[str] = ..., address: _Optional[str] = ...) -> None: ...

class BleDevice(_message.Message):
    __slots__ = ("address", "name", "service_uuids")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SERVICE_UUIDS_FIELD_NUMBER: _ClassVar[int]
    address: str
    name: str
    service_uuids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, address: _Optional[str] = ..., name: _Optional[str] = ..., service_uuids: _Optional[_Iterable[str]] = ...) -> None: ...

class ConfigurationComponent(_message.Message):
    __slots__ = ("value", "version")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    value: _struct_pb2.Struct
    version: int
    def __init__(self, value: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., version: _Optional[int] = ...) -> None: ...

class ChatComponent(_message.Message):
    __slots__ = ("sender", "to", "message", "reply_to", "reaction")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_FIELD_NUMBER: _ClassVar[int]
    REACTION_FIELD_NUMBER: _ClassVar[int]
    sender: str
    to: str
    message: str
    reply_to: str
    reaction: bool
    def __init__(self, sender: _Optional[str] = ..., to: _Optional[str] = ..., message: _Optional[str] = ..., reply_to: _Optional[str] = ..., reaction: bool = ...) -> None: ...

class AssemblyComponent(_message.Message):
    __slots__ = ("parent", "outline")
    PARENT_FIELD_NUMBER: _ClassVar[int]
    OUTLINE_FIELD_NUMBER: _ClassVar[int]
    parent: str
    outline: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, parent: _Optional[str] = ..., outline: _Optional[_Iterable[str]] = ...) -> None: ...

class MapLayerComponent(_message.Message):
    __slots__ = ("z_index", "opacity", "tiles", "image")
    class Tile(_message.Message):
        __slots__ = ("url",)
        URL_FIELD_NUMBER: _ClassVar[int]
        url: str
        def __init__(self, url: _Optional[str] = ...) -> None: ...
    class Image(_message.Message):
        __slots__ = ("url", "width_m", "height_m")
        URL_FIELD_NUMBER: _ClassVar[int]
        WIDTH_M_FIELD_NUMBER: _ClassVar[int]
        HEIGHT_M_FIELD_NUMBER: _ClassVar[int]
        url: str
        width_m: float
        height_m: float
        def __init__(self, url: _Optional[str] = ..., width_m: _Optional[float] = ..., height_m: _Optional[float] = ...) -> None: ...
    Z_INDEX_FIELD_NUMBER: _ClassVar[int]
    OPACITY_FIELD_NUMBER: _ClassVar[int]
    TILES_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    z_index: int
    opacity: float
    tiles: MapLayerComponent.Tile
    image: MapLayerComponent.Image
    def __init__(self, z_index: _Optional[int] = ..., opacity: _Optional[float] = ..., tiles: _Optional[_Union[MapLayerComponent.Tile, _Mapping]] = ..., image: _Optional[_Union[MapLayerComponent.Image, _Mapping]] = ...) -> None: ...

class ManualControlComponent(_message.Message):
    __slots__ = ("input",)
    INPUT_FIELD_NUMBER: _ClassVar[int]
    input: _containers.RepeatedCompositeFieldContainer[_manualcontrol_pb2.ManualControlInput]
    def __init__(self, input: _Optional[_Iterable[_Union[_manualcontrol_pb2.ManualControlInput, _Mapping]]] = ...) -> None: ...

class TargetManualControlComponent(_message.Message):
    __slots__ = ("input", "session", "at")
    INPUT_FIELD_NUMBER: _ClassVar[int]
    SESSION_FIELD_NUMBER: _ClassVar[int]
    AT_FIELD_NUMBER: _ClassVar[int]
    input: _containers.RepeatedCompositeFieldContainer[_manualcontrol_pb2.ManualControlInput]
    session: str
    at: _timestamp_pb2.Timestamp
    def __init__(self, input: _Optional[_Iterable[_Union[_manualcontrol_pb2.ManualControlInput, _Mapping]]] = ..., session: _Optional[str] = ..., at: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class EntityFilter(_message.Message):
    __slots__ = ("id", "label", "geo", "taskable", "component", "capture", "controller", "track", "mission", "channel", "device", "config")
    ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    GEO_FIELD_NUMBER: _ClassVar[int]
    TASKABLE_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_FIELD_NUMBER: _ClassVar[int]
    CAPTURE_FIELD_NUMBER: _ClassVar[int]
    CONTROLLER_FIELD_NUMBER: _ClassVar[int]
    TRACK_FIELD_NUMBER: _ClassVar[int]
    MISSION_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    DEVICE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    OR_FIELD_NUMBER: _ClassVar[int]
    NOT_FIELD_NUMBER: _ClassVar[int]
    id: str
    label: str
    geo: GeoFilter
    taskable: TaskableFilter
    component: _containers.RepeatedScalarFieldContainer[int]
    capture: CaptureFilter
    controller: ControllerFilter
    track: TrackFilter
    mission: MissionFilter
    channel: ChannelFilter
    device: DeviceFilter
    config: ConfigurationFilter
    def __init__(self, id: _Optional[str] = ..., label: _Optional[str] = ..., geo: _Optional[_Union[GeoFilter, _Mapping]] = ..., taskable: _Optional[_Union[TaskableFilter, _Mapping]] = ..., component: _Optional[_Iterable[int]] = ..., capture: _Optional[_Union[CaptureFilter, _Mapping]] = ..., controller: _Optional[_Union[ControllerFilter, _Mapping]] = ..., track: _Optional[_Union[TrackFilter, _Mapping]] = ..., mission: _Optional[_Union[MissionFilter, _Mapping]] = ..., channel: _Optional[_Union[ChannelFilter, _Mapping]] = ..., device: _Optional[_Union[DeviceFilter, _Mapping]] = ..., config: _Optional[_Union[ConfigurationFilter, _Mapping]] = ..., **kwargs) -> None: ...

class ControllerFilter(_message.Message):
    __slots__ = ("id", "node", "origin")
    ID_FIELD_NUMBER: _ClassVar[int]
    NODE_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    id: str
    node: str
    origin: str
    def __init__(self, id: _Optional[str] = ..., node: _Optional[str] = ..., origin: _Optional[str] = ...) -> None: ...

class TrackFilter(_message.Message):
    __slots__ = ("tracker",)
    TRACKER_FIELD_NUMBER: _ClassVar[int]
    tracker: str
    def __init__(self, tracker: _Optional[str] = ...) -> None: ...

class MissionFilter(_message.Message):
    __slots__ = ("mission_id", "member_id")
    MISSION_ID_FIELD_NUMBER: _ClassVar[int]
    MEMBER_ID_FIELD_NUMBER: _ClassVar[int]
    mission_id: str
    member_id: str
    def __init__(self, mission_id: _Optional[str] = ..., member_id: _Optional[str] = ...) -> None: ...

class TaskableFilter(_message.Message):
    __slots__ = ("context", "assignee")
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    ASSIGNEE_FIELD_NUMBER: _ClassVar[int]
    context: TaskableContext
    assignee: TaskableAssignee
    def __init__(self, context: _Optional[_Union[TaskableContext, _Mapping]] = ..., assignee: _Optional[_Union[TaskableAssignee, _Mapping]] = ...) -> None: ...

class GeoFilter(_message.Message):
    __slots__ = ("geometry", "geoEntityId")
    GEOMETRY_FIELD_NUMBER: _ClassVar[int]
    GEOENTITYID_FIELD_NUMBER: _ClassVar[int]
    geometry: Geometry
    geoEntityId: str
    def __init__(self, geometry: _Optional[_Union[Geometry, _Mapping]] = ..., geoEntityId: _Optional[str] = ...) -> None: ...

class DeviceFilter(_message.Message):
    __slots__ = ("parent", "unique_hardware_id", "device_class", "ble", "usb")
    PARENT_FIELD_NUMBER: _ClassVar[int]
    UNIQUE_HARDWARE_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_CLASS_FIELD_NUMBER: _ClassVar[int]
    BLE_FIELD_NUMBER: _ClassVar[int]
    USB_FIELD_NUMBER: _ClassVar[int]
    parent: str
    unique_hardware_id: str
    device_class: str
    ble: BleDeviceFilter
    usb: UsbDeviceFilter
    def __init__(self, parent: _Optional[str] = ..., unique_hardware_id: _Optional[str] = ..., device_class: _Optional[str] = ..., ble: _Optional[_Union[BleDeviceFilter, _Mapping]] = ..., usb: _Optional[_Union[UsbDeviceFilter, _Mapping]] = ...) -> None: ...

class BleDeviceFilter(_message.Message):
    __slots__ = ("address", "name", "service_uuids")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SERVICE_UUIDS_FIELD_NUMBER: _ClassVar[int]
    address: str
    name: str
    service_uuids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, address: _Optional[str] = ..., name: _Optional[str] = ..., service_uuids: _Optional[_Iterable[str]] = ...) -> None: ...

class UsbDeviceFilter(_message.Message):
    __slots__ = ("vendor_id", "product_id", "device_class", "device_subclass", "device_protocol", "manufacturer_name", "product_name", "serial_number")
    VENDOR_ID_FIELD_NUMBER: _ClassVar[int]
    PRODUCT_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_CLASS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_SUBCLASS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    MANUFACTURER_NAME_FIELD_NUMBER: _ClassVar[int]
    PRODUCT_NAME_FIELD_NUMBER: _ClassVar[int]
    SERIAL_NUMBER_FIELD_NUMBER: _ClassVar[int]
    vendor_id: int
    product_id: int
    device_class: int
    device_subclass: int
    device_protocol: int
    manufacturer_name: str
    product_name: str
    serial_number: str
    def __init__(self, vendor_id: _Optional[int] = ..., product_id: _Optional[int] = ..., device_class: _Optional[int] = ..., device_subclass: _Optional[int] = ..., device_protocol: _Optional[int] = ..., manufacturer_name: _Optional[str] = ..., product_name: _Optional[str] = ..., serial_number: _Optional[str] = ...) -> None: ...

class ConfigurationFilter(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ChannelFilter(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class SortOption(_message.Message):
    __slots__ = ("field", "descending", "metric_id", "metric_kind")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    DESCENDING_FIELD_NUMBER: _ClassVar[int]
    METRIC_ID_FIELD_NUMBER: _ClassVar[int]
    METRIC_KIND_FIELD_NUMBER: _ClassVar[int]
    field: SortField
    descending: bool
    metric_id: int
    metric_kind: _metrics_pb2.MetricKind
    def __init__(self, field: _Optional[_Union[SortField, str]] = ..., descending: bool = ..., metric_id: _Optional[int] = ..., metric_kind: _Optional[_Union[_metrics_pb2.MetricKind, str]] = ...) -> None: ...

class WatchBehavior(_message.Message):
    __slots__ = ("max_rate_hz", "min_priority", "keepalive_interval_ms", "diff", "heartbeat_interval_ms")
    MAX_RATE_HZ_FIELD_NUMBER: _ClassVar[int]
    MIN_PRIORITY_FIELD_NUMBER: _ClassVar[int]
    KEEPALIVE_INTERVAL_MS_FIELD_NUMBER: _ClassVar[int]
    DIFF_FIELD_NUMBER: _ClassVar[int]
    HEARTBEAT_INTERVAL_MS_FIELD_NUMBER: _ClassVar[int]
    max_rate_hz: float
    min_priority: Priority
    keepalive_interval_ms: int
    diff: bool
    heartbeat_interval_ms: int
    def __init__(self, max_rate_hz: _Optional[float] = ..., min_priority: _Optional[_Union[Priority, str]] = ..., keepalive_interval_ms: _Optional[int] = ..., diff: bool = ..., heartbeat_interval_ms: _Optional[int] = ...) -> None: ...

class ListEntitiesRequest(_message.Message):
    __slots__ = ("filter", "sort", "behaviour", "dump_internal")
    FILTER_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_NUMBER: _ClassVar[int]
    BEHAVIOUR_FIELD_NUMBER: _ClassVar[int]
    DUMP_INTERNAL_FIELD_NUMBER: _ClassVar[int]
    filter: EntityFilter
    sort: _containers.RepeatedCompositeFieldContainer[SortOption]
    behaviour: WatchBehavior
    dump_internal: bool
    def __init__(self, filter: _Optional[_Union[EntityFilter, _Mapping]] = ..., sort: _Optional[_Iterable[_Union[SortOption, _Mapping]]] = ..., behaviour: _Optional[_Union[WatchBehavior, _Mapping]] = ..., dump_internal: bool = ...) -> None: ...

class ListEntitiesResponse(_message.Message):
    __slots__ = ("entities", "internal")
    ENTITIES_FIELD_NUMBER: _ClassVar[int]
    INTERNAL_FIELD_NUMBER: _ClassVar[int]
    entities: _containers.RepeatedCompositeFieldContainer[Entity]
    internal: _containers.RepeatedCompositeFieldContainer[_struct_pb2.Struct]
    def __init__(self, entities: _Optional[_Iterable[_Union[Entity, _Mapping]]] = ..., internal: _Optional[_Iterable[_Union[_struct_pb2.Struct, _Mapping]]] = ...) -> None: ...

class EntityChangeRequest(_message.Message):
    __slots__ = ("changes", "replacements")
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    REPLACEMENTS_FIELD_NUMBER: _ClassVar[int]
    changes: _containers.RepeatedCompositeFieldContainer[Entity]
    replacements: _containers.RepeatedCompositeFieldContainer[Entity]
    def __init__(self, changes: _Optional[_Iterable[_Union[Entity, _Mapping]]] = ..., replacements: _Optional[_Iterable[_Union[Entity, _Mapping]]] = ...) -> None: ...

class ExpireEntityRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class ExpireEntityResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntityChangeResponse(_message.Message):
    __slots__ = ("accepted", "debug")
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    DEBUG_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    debug: str
    def __init__(self, accepted: bool = ..., debug: _Optional[str] = ...) -> None: ...

class EntityChangeEvent(_message.Message):
    __slots__ = ("entity", "t", "now")
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    T_FIELD_NUMBER: _ClassVar[int]
    NOW_FIELD_NUMBER: _ClassVar[int]
    entity: Entity
    t: EntityChange
    now: _timestamp_pb2.Timestamp
    def __init__(self, entity: _Optional[_Union[Entity, _Mapping]] = ..., t: _Optional[_Union[EntityChange, str]] = ..., now: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class EntityChangeBatch(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[EntityChangeEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[EntityChangeEvent, _Mapping]]] = ...) -> None: ...

class GetEntityRequest(_message.Message):
    __slots__ = ("id", "dump_internal")
    ID_FIELD_NUMBER: _ClassVar[int]
    DUMP_INTERNAL_FIELD_NUMBER: _ClassVar[int]
    id: str
    dump_internal: bool
    def __init__(self, id: _Optional[str] = ..., dump_internal: bool = ...) -> None: ...

class GetEntityResponse(_message.Message):
    __slots__ = ("entity", "internal")
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    INTERNAL_FIELD_NUMBER: _ClassVar[int]
    entity: Entity
    internal: _struct_pb2.Struct
    def __init__(self, entity: _Optional[_Union[Entity, _Mapping]] = ..., internal: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class GetSelfRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetSelfResponse(_message.Message):
    __slots__ = ("entity_id", "entity")
    ENTITY_ID_FIELD_NUMBER: _ClassVar[int]
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    entity_id: str
    entity: Entity
    def __init__(self, entity_id: _Optional[str] = ..., entity: _Optional[_Union[Entity, _Mapping]] = ...) -> None: ...

class GetLocalNodeRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetLocalNodeResponse(_message.Message):
    __slots__ = ("entity", "node_id")
    ENTITY_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    entity: Entity
    node_id: str
    def __init__(self, entity: _Optional[_Union[Entity, _Mapping]] = ..., node_id: _Optional[str] = ...) -> None: ...

class ObserverRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ObserverState(_message.Message):
    __slots__ = ("geo", "viewHistory")
    GEO_FIELD_NUMBER: _ClassVar[int]
    VIEWHISTORY_FIELD_NUMBER: _ClassVar[int]
    geo: Geometry
    viewHistory: _timestamp_pb2.Timestamp
    def __init__(self, geo: _Optional[_Union[Geometry, _Mapping]] = ..., viewHistory: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RunTaskRequest(_message.Message):
    __slots__ = ("entityId", "priority", "target")
    ENTITYID_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    entityId: str
    priority: int
    target: _tasking_pb2.TaskExecutionTarget
    def __init__(self, entityId: _Optional[str] = ..., priority: _Optional[int] = ..., target: _Optional[_Union[_tasking_pb2.TaskExecutionTarget, _Mapping]] = ...) -> None: ...

class RunTaskResponse(_message.Message):
    __slots__ = ("executionId", "status", "humanReadableReason")
    EXECUTIONID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    HUMANREADABLEREASON_FIELD_NUMBER: _ClassVar[int]
    executionId: str
    status: TaskStatus
    humanReadableReason: str
    def __init__(self, executionId: _Optional[str] = ..., status: _Optional[_Union[TaskStatus, str]] = ..., humanReadableReason: _Optional[str] = ...) -> None: ...

class CancelTaskRequest(_message.Message):
    __slots__ = ("executionId",)
    EXECUTIONID_FIELD_NUMBER: _ClassVar[int]
    executionId: str
    def __init__(self, executionId: _Optional[str] = ...) -> None: ...

class CancelTaskResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HardResetRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HardResetResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class LoadMissionRequest(_message.Message):
    __slots__ = ("artifact_id",)
    ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    artifact_id: str
    def __init__(self, artifact_id: _Optional[str] = ...) -> None: ...

class LoadMissionResponse(_message.Message):
    __slots__ = ("mission", "error")
    MISSION_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    mission: MissionPack
    error: str
    def __init__(self, mission: _Optional[_Union[MissionPack, _Mapping]] = ..., error: _Optional[str] = ...) -> None: ...

class TimeSyncRequest(_message.Message):
    __slots__ = ("t1", "t4")
    T1_FIELD_NUMBER: _ClassVar[int]
    T4_FIELD_NUMBER: _ClassVar[int]
    t1: _timestamp_pb2.Timestamp
    t4: _timestamp_pb2.Timestamp
    def __init__(self, t1: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., t4: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class TimeSyncResponse(_message.Message):
    __slots__ = ("t1", "t2", "t3")
    T1_FIELD_NUMBER: _ClassVar[int]
    T2_FIELD_NUMBER: _ClassVar[int]
    T3_FIELD_NUMBER: _ClassVar[int]
    t1: _timestamp_pb2.Timestamp
    t2: _timestamp_pb2.Timestamp
    t3: _timestamp_pb2.Timestamp
    def __init__(self, t1: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., t2: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ..., t3: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
