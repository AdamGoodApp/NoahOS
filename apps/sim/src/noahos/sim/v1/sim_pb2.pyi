from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Role(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROLE_UNSPECIFIED: _ClassVar[Role]
    ROLE_OPERATOR: _ClassVar[Role]
    ROLE_VIEWER: _ClassVar[Role]

class Mode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MODE_UNSPECIFIED: _ClassVar[Mode]
    MODE_AUTO: _ClassVar[Mode]
    MODE_MANUAL: _ClassVar[Mode]
    MODE_STOPPED: _ClassVar[Mode]

class JointKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    JOINT_KIND_UNSPECIFIED: _ClassVar[JointKind]
    JOINT_KIND_HINGE: _ClassVar[JointKind]
    JOINT_KIND_SLIDE: _ClassVar[JointKind]

class EventKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVENT_KIND_UNSPECIFIED: _ClassVar[EventKind]
    EVENT_KIND_INFO: _ClassVar[EventKind]
    EVENT_KIND_MODE: _ClassVar[EventKind]
    EVENT_KIND_ROLE: _ClassVar[EventKind]
    EVENT_KIND_DENIED: _ClassVar[EventKind]
    EVENT_KIND_ERROR: _ClassVar[EventKind]
    EVENT_KIND_RECORDING: _ClassVar[EventKind]
ROLE_UNSPECIFIED: Role
ROLE_OPERATOR: Role
ROLE_VIEWER: Role
MODE_UNSPECIFIED: Mode
MODE_AUTO: Mode
MODE_MANUAL: Mode
MODE_STOPPED: Mode
JOINT_KIND_UNSPECIFIED: JointKind
JOINT_KIND_HINGE: JointKind
JOINT_KIND_SLIDE: JointKind
EVENT_KIND_UNSPECIFIED: EventKind
EVENT_KIND_INFO: EventKind
EVENT_KIND_MODE: EventKind
EVENT_KIND_ROLE: EventKind
EVENT_KIND_DENIED: EventKind
EVENT_KIND_ERROR: EventKind
EVENT_KIND_RECORDING: EventKind

class ClientMessage(_message.Message):
    __slots__ = ("hello", "ping", "joint_targets", "set_mode", "estop", "recording")
    HELLO_FIELD_NUMBER: _ClassVar[int]
    PING_FIELD_NUMBER: _ClassVar[int]
    JOINT_TARGETS_FIELD_NUMBER: _ClassVar[int]
    SET_MODE_FIELD_NUMBER: _ClassVar[int]
    ESTOP_FIELD_NUMBER: _ClassVar[int]
    RECORDING_FIELD_NUMBER: _ClassVar[int]
    hello: Hello
    ping: Ping
    joint_targets: JointTargets
    set_mode: SetMode
    estop: EStop
    recording: Recording
    def __init__(self, hello: _Optional[_Union[Hello, _Mapping]] = ..., ping: _Optional[_Union[Ping, _Mapping]] = ..., joint_targets: _Optional[_Union[JointTargets, _Mapping]] = ..., set_mode: _Optional[_Union[SetMode, _Mapping]] = ..., estop: _Optional[_Union[EStop, _Mapping]] = ..., recording: _Optional[_Union[Recording, _Mapping]] = ...) -> None: ...

class ServerMessage(_message.Message):
    __slots__ = ("welcome", "session", "pong", "telemetry", "event")
    WELCOME_FIELD_NUMBER: _ClassVar[int]
    SESSION_FIELD_NUMBER: _ClassVar[int]
    PONG_FIELD_NUMBER: _ClassVar[int]
    TELEMETRY_FIELD_NUMBER: _ClassVar[int]
    EVENT_FIELD_NUMBER: _ClassVar[int]
    welcome: Welcome
    session: SessionInfo
    pong: Pong
    telemetry: Telemetry
    event: Event
    def __init__(self, welcome: _Optional[_Union[Welcome, _Mapping]] = ..., session: _Optional[_Union[SessionInfo, _Mapping]] = ..., pong: _Optional[_Union[Pong, _Mapping]] = ..., telemetry: _Optional[_Union[Telemetry, _Mapping]] = ..., event: _Optional[_Union[Event, _Mapping]] = ...) -> None: ...

class Hello(_message.Message):
    __slots__ = ("client_id", "role", "telemetry_divisor", "pair_token")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    TELEMETRY_DIVISOR_FIELD_NUMBER: _ClassVar[int]
    PAIR_TOKEN_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    role: Role
    telemetry_divisor: int
    pair_token: str
    def __init__(self, client_id: _Optional[str] = ..., role: _Optional[_Union[Role, str]] = ..., telemetry_divisor: _Optional[int] = ..., pair_token: _Optional[str] = ...) -> None: ...

class Ping(_message.Message):
    __slots__ = ("client_id", "client_ms")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_MS_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    client_ms: int
    def __init__(self, client_id: _Optional[str] = ..., client_ms: _Optional[int] = ...) -> None: ...

class Pong(_message.Message):
    __slots__ = ("client_id", "client_ms", "server_unix_ns")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_MS_FIELD_NUMBER: _ClassVar[int]
    SERVER_UNIX_NS_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    client_ms: int
    server_unix_ns: int
    def __init__(self, client_id: _Optional[str] = ..., client_ms: _Optional[int] = ..., server_unix_ns: _Optional[int] = ...) -> None: ...

class JointTargets(_message.Message):
    __slots__ = ("joint_index", "target")
    JOINT_INDEX_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    joint_index: _containers.RepeatedScalarFieldContainer[int]
    target: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, joint_index: _Optional[_Iterable[int]] = ..., target: _Optional[_Iterable[float]] = ...) -> None: ...

class SetMode(_message.Message):
    __slots__ = ("mode", "policy")
    MODE_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    mode: Mode
    policy: str
    def __init__(self, mode: _Optional[_Union[Mode, str]] = ..., policy: _Optional[str] = ...) -> None: ...

class EStop(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class Recording(_message.Message):
    __slots__ = ("start", "task_label")
    START_FIELD_NUMBER: _ClassVar[int]
    TASK_LABEL_FIELD_NUMBER: _ClassVar[int]
    start: bool
    task_label: str
    def __init__(self, start: _Optional[bool] = ..., task_label: _Optional[str] = ...) -> None: ...

class Welcome(_message.Message):
    __slots__ = ("session_id", "robot", "mode", "cameras", "telemetry_hz", "policies")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ROBOT_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    CAMERAS_FIELD_NUMBER: _ClassVar[int]
    TELEMETRY_HZ_FIELD_NUMBER: _ClassVar[int]
    POLICIES_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    robot: RobotSpec
    mode: Mode
    cameras: _containers.RepeatedCompositeFieldContainer[CameraSpec]
    telemetry_hz: int
    policies: _containers.RepeatedCompositeFieldContainer[PolicySpec]
    def __init__(self, session_id: _Optional[str] = ..., robot: _Optional[_Union[RobotSpec, _Mapping]] = ..., mode: _Optional[_Union[Mode, str]] = ..., cameras: _Optional[_Iterable[_Union[CameraSpec, _Mapping]]] = ..., telemetry_hz: _Optional[int] = ..., policies: _Optional[_Iterable[_Union[PolicySpec, _Mapping]]] = ...) -> None: ...

class PolicySpec(_message.Message):
    __slots__ = ("id", "name", "description", "period_s", "holds_base")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PERIOD_S_FIELD_NUMBER: _ClassVar[int]
    HOLDS_BASE_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    description: str
    period_s: float
    holds_base: bool
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., period_s: _Optional[float] = ..., holds_base: _Optional[bool] = ...) -> None: ...

class SessionInfo(_message.Message):
    __slots__ = ("your_client_id", "granted_role", "operator_id", "clients")
    YOUR_CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_ROLE_FIELD_NUMBER: _ClassVar[int]
    OPERATOR_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENTS_FIELD_NUMBER: _ClassVar[int]
    your_client_id: str
    granted_role: Role
    operator_id: str
    clients: int
    def __init__(self, your_client_id: _Optional[str] = ..., granted_role: _Optional[_Union[Role, str]] = ..., operator_id: _Optional[str] = ..., clients: _Optional[int] = ...) -> None: ...

class RobotSpec(_message.Message):
    __slots__ = ("robot_id", "joints", "base_joint", "timestep")
    ROBOT_ID_FIELD_NUMBER: _ClassVar[int]
    JOINTS_FIELD_NUMBER: _ClassVar[int]
    BASE_JOINT_FIELD_NUMBER: _ClassVar[int]
    TIMESTEP_FIELD_NUMBER: _ClassVar[int]
    robot_id: str
    joints: _containers.RepeatedCompositeFieldContainer[JointSpec]
    base_joint: str
    timestep: float
    def __init__(self, robot_id: _Optional[str] = ..., joints: _Optional[_Iterable[_Union[JointSpec, _Mapping]]] = ..., base_joint: _Optional[str] = ..., timestep: _Optional[float] = ...) -> None: ...

class JointSpec(_message.Message):
    __slots__ = ("name", "kind", "limited", "range_min", "range_max", "actuated", "effort_limit")
    NAME_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    LIMITED_FIELD_NUMBER: _ClassVar[int]
    RANGE_MIN_FIELD_NUMBER: _ClassVar[int]
    RANGE_MAX_FIELD_NUMBER: _ClassVar[int]
    ACTUATED_FIELD_NUMBER: _ClassVar[int]
    EFFORT_LIMIT_FIELD_NUMBER: _ClassVar[int]
    name: str
    kind: JointKind
    limited: bool
    range_min: float
    range_max: float
    actuated: bool
    effort_limit: float
    def __init__(self, name: _Optional[str] = ..., kind: _Optional[_Union[JointKind, str]] = ..., limited: _Optional[bool] = ..., range_min: _Optional[float] = ..., range_max: _Optional[float] = ..., actuated: _Optional[bool] = ..., effort_limit: _Optional[float] = ...) -> None: ...

class CameraSpec(_message.Message):
    __slots__ = ("name", "width", "height", "fps", "sfu_session_id", "track_name")
    NAME_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    FPS_FIELD_NUMBER: _ClassVar[int]
    SFU_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TRACK_NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    width: int
    height: int
    fps: int
    sfu_session_id: str
    track_name: str
    def __init__(self, name: _Optional[str] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., fps: _Optional[int] = ..., sfu_session_id: _Optional[str] = ..., track_name: _Optional[str] = ...) -> None: ...

class Pose(_message.Message):
    __slots__ = ("x", "y", "z", "qw", "qx", "qy", "qz")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    QW_FIELD_NUMBER: _ClassVar[int]
    QX_FIELD_NUMBER: _ClassVar[int]
    QY_FIELD_NUMBER: _ClassVar[int]
    QZ_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    z: float
    qw: float
    qx: float
    qy: float
    qz: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ..., z: _Optional[float] = ..., qw: _Optional[float] = ..., qx: _Optional[float] = ..., qy: _Optional[float] = ..., qz: _Optional[float] = ...) -> None: ...

class SimStats(_message.Message):
    __slots__ = ("realtime_factor", "physics_hz", "step_ms", "render_ms", "cpu_percent")
    REALTIME_FACTOR_FIELD_NUMBER: _ClassVar[int]
    PHYSICS_HZ_FIELD_NUMBER: _ClassVar[int]
    STEP_MS_FIELD_NUMBER: _ClassVar[int]
    RENDER_MS_FIELD_NUMBER: _ClassVar[int]
    CPU_PERCENT_FIELD_NUMBER: _ClassVar[int]
    realtime_factor: float
    physics_hz: float
    step_ms: float
    render_ms: float
    cpu_percent: float
    def __init__(self, realtime_factor: _Optional[float] = ..., physics_hz: _Optional[float] = ..., step_ms: _Optional[float] = ..., render_ms: _Optional[float] = ..., cpu_percent: _Optional[float] = ...) -> None: ...

class Telemetry(_message.Message):
    __slots__ = ("seq", "sim_time", "sent_unix_ns", "mode", "qpos", "qvel", "torque", "power_w", "motor_temp_c", "target", "base", "battery_percent", "contacts", "total_power_w", "stats", "task_cycle", "task_phase", "recording", "policy")
    SEQ_FIELD_NUMBER: _ClassVar[int]
    SIM_TIME_FIELD_NUMBER: _ClassVar[int]
    SENT_UNIX_NS_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    QPOS_FIELD_NUMBER: _ClassVar[int]
    QVEL_FIELD_NUMBER: _ClassVar[int]
    TORQUE_FIELD_NUMBER: _ClassVar[int]
    POWER_W_FIELD_NUMBER: _ClassVar[int]
    MOTOR_TEMP_C_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    BASE_FIELD_NUMBER: _ClassVar[int]
    BATTERY_PERCENT_FIELD_NUMBER: _ClassVar[int]
    CONTACTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_POWER_W_FIELD_NUMBER: _ClassVar[int]
    STATS_FIELD_NUMBER: _ClassVar[int]
    TASK_CYCLE_FIELD_NUMBER: _ClassVar[int]
    TASK_PHASE_FIELD_NUMBER: _ClassVar[int]
    RECORDING_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    seq: int
    sim_time: float
    sent_unix_ns: int
    mode: Mode
    qpos: _containers.RepeatedScalarFieldContainer[float]
    qvel: _containers.RepeatedScalarFieldContainer[float]
    torque: _containers.RepeatedScalarFieldContainer[float]
    power_w: _containers.RepeatedScalarFieldContainer[float]
    motor_temp_c: _containers.RepeatedScalarFieldContainer[float]
    target: _containers.RepeatedScalarFieldContainer[float]
    base: Pose
    battery_percent: float
    contacts: int
    total_power_w: float
    stats: SimStats
    task_cycle: int
    task_phase: float
    recording: bool
    policy: str
    def __init__(self, seq: _Optional[int] = ..., sim_time: _Optional[float] = ..., sent_unix_ns: _Optional[int] = ..., mode: _Optional[_Union[Mode, str]] = ..., qpos: _Optional[_Iterable[float]] = ..., qvel: _Optional[_Iterable[float]] = ..., torque: _Optional[_Iterable[float]] = ..., power_w: _Optional[_Iterable[float]] = ..., motor_temp_c: _Optional[_Iterable[float]] = ..., target: _Optional[_Iterable[float]] = ..., base: _Optional[_Union[Pose, _Mapping]] = ..., battery_percent: _Optional[float] = ..., contacts: _Optional[int] = ..., total_power_w: _Optional[float] = ..., stats: _Optional[_Union[SimStats, _Mapping]] = ..., task_cycle: _Optional[int] = ..., task_phase: _Optional[float] = ..., recording: _Optional[bool] = ..., policy: _Optional[str] = ...) -> None: ...

class Event(_message.Message):
    __slots__ = ("kind", "message", "mode", "operator_id", "unix_ns")
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    OPERATOR_ID_FIELD_NUMBER: _ClassVar[int]
    UNIX_NS_FIELD_NUMBER: _ClassVar[int]
    kind: EventKind
    message: str
    mode: Mode
    operator_id: str
    unix_ns: int
    def __init__(self, kind: _Optional[_Union[EventKind, str]] = ..., message: _Optional[str] = ..., mode: _Optional[_Union[Mode, str]] = ..., operator_id: _Optional[str] = ..., unix_ns: _Optional[int] = ...) -> None: ...
