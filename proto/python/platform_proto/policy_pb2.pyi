from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PolicyAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PolicyActionInvalid: _ClassVar[PolicyAction]
    PolicyActionDeny: _ClassVar[PolicyAction]
    PolicyActionAllow: _ClassVar[PolicyAction]
    PolicyActionLog: _ClassVar[PolicyAction]
    PolicyActionDefer: _ClassVar[PolicyAction]
PolicyActionInvalid: PolicyAction
PolicyActionDeny: PolicyAction
PolicyActionAllow: PolicyAction
PolicyActionLog: PolicyAction
PolicyActionDefer: PolicyAction

class PolicyRule(_message.Message):
    __slots__ = ("action", "cel", "label")
    ACTION_FIELD_NUMBER: _ClassVar[int]
    CEL_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    action: PolicyAction
    cel: str
    label: str
    def __init__(self, action: _Optional[_Union[PolicyAction, str]] = ..., cel: _Optional[str] = ..., label: _Optional[str] = ...) -> None: ...

class PolicyComponent(_message.Message):
    __slots__ = ("rules",)
    RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[PolicyRule]
    def __init__(self, rules: _Optional[_Iterable[_Union[PolicyRule, _Mapping]]] = ...) -> None: ...

class EntitlementCop(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementCopWrite(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementIam(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementPolicy(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementTasking(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementConsequential(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementReset(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementArtifactsRead(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementSecrets(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class EntitlementSecretsRead(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class Entitlement(_message.Message):
    __slots__ = ("cop", "cop_write", "iam", "policy", "tasking", "consequential", "reset", "artifacts_read", "secrets", "secrets_read")
    COP_FIELD_NUMBER: _ClassVar[int]
    COP_WRITE_FIELD_NUMBER: _ClassVar[int]
    IAM_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    TASKING_FIELD_NUMBER: _ClassVar[int]
    CONSEQUENTIAL_FIELD_NUMBER: _ClassVar[int]
    RESET_FIELD_NUMBER: _ClassVar[int]
    ARTIFACTS_READ_FIELD_NUMBER: _ClassVar[int]
    SECRETS_FIELD_NUMBER: _ClassVar[int]
    SECRETS_READ_FIELD_NUMBER: _ClassVar[int]
    cop: EntitlementCop
    cop_write: EntitlementCopWrite
    iam: EntitlementIam
    policy: EntitlementPolicy
    tasking: EntitlementTasking
    consequential: EntitlementConsequential
    reset: EntitlementReset
    artifacts_read: EntitlementArtifactsRead
    secrets: EntitlementSecrets
    secrets_read: EntitlementSecretsRead
    def __init__(self, cop: _Optional[_Union[EntitlementCop, _Mapping]] = ..., cop_write: _Optional[_Union[EntitlementCopWrite, _Mapping]] = ..., iam: _Optional[_Union[EntitlementIam, _Mapping]] = ..., policy: _Optional[_Union[EntitlementPolicy, _Mapping]] = ..., tasking: _Optional[_Union[EntitlementTasking, _Mapping]] = ..., consequential: _Optional[_Union[EntitlementConsequential, _Mapping]] = ..., reset: _Optional[_Union[EntitlementReset, _Mapping]] = ..., artifacts_read: _Optional[_Union[EntitlementArtifactsRead, _Mapping]] = ..., secrets: _Optional[_Union[EntitlementSecrets, _Mapping]] = ..., secrets_read: _Optional[_Union[EntitlementSecretsRead, _Mapping]] = ...) -> None: ...

class AuthorizationComponent(_message.Message):
    __slots__ = ("entitlements",)
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    entitlements: _containers.RepeatedCompositeFieldContainer[Entitlement]
    def __init__(self, entitlements: _Optional[_Iterable[_Union[Entitlement, _Mapping]]] = ...) -> None: ...
