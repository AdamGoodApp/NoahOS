# NoahOS Live Stack

MuJoCo simulation ⇄ Control page: two-way telemetry and control over WebSocket + Protobuf, live robot cameras over WebRTC, one simulation per robot in Docker, Cloudflare-native deployment. Status (2026-11-04): **Phases 1–5 built and verified locally; Phase 6 deployed on Cloudflare and verified in production on 2026-11-03, then taken offline on 2026-11-04 (configuration kept; a redeploy needs a new D1 database) (Worker, a Durable Object per robot, a Container per live sim, D1 accounts, the AI assistant through AI Gateway); Phase 1b not done; Phase 7 partly done (R2 upload missing)** — §10.1 lists what was verified, what was not, and how the build differs from the first plan.

Before this stack (`apps/web`): fleet dashboard (`/app`), Control page (`/app/robots/$id`) with a client-side MJCF parser, three.js twin, joint wheel/pad, IK drag, undo/redo; the `Live view` button, the `Simulation`/`Logs` tabs and the Latency/CPU tiles were placeholders. The live stack below now fills them.

## 1. Goals and job-description mapping


| JD responsibility / qualification | What this stack does | Where |
| --- | --- | --- |
| Teleoperation: real-time control, low-latency A/V streaming, operator UI | 60 Hz joint telemetry + ≤60 Hz joint targets over a binary WebSocket (Protobuf), targets only in Manual hold (never while a task runs); two robot cameras over WebRTC via Cloudflare Realtime SFU; the existing Control page becomes the operator UI in live mode (§7.4) | §3, §4, §7 |
| Data-quality feedback in the teleop UI | Signal tile (telemetry Hz, jitter, drops), RTT and telemetry-age readouts, joints-at-limit count and the existing red at-limit highlight, task-phase progress | §7.7 |
| Internal tools, dashboards, realtime dashboards | Fleet dashboard (exists); Simulation tab with camera dock, telemetry tiles, per-joint table, device console; Logs tab | §7.5, §7.6 |
| Build/monitor data pipelines; VLA/ML ingestion | Episode recording to MCAP (Foxglove/ROS-compatible container with the same Protobuf telemetry + JPEG camera frames), list/download from the UI, open in Foxglove; Phase 7 (stretch) uploads finished episodes to R2 | §5.7, §10 |
| APIs between services | FastAPI orchestrator (OpenAPI at `/docs`), Worker `/api/live/*` routes, one Protobuf contract shared by Python and TypeScript (`proto/`) | §4, §5.8, §6.1 |
| Configuration management (robot configs, task descriptions) | `apps/sim/robots.yaml`: per-robot sim config and task description, served by `GET /robots`, shown in the Welcome/Simulation tab | §5.9 |
| Secure communication, authentication, access control | Operator lock + viewer role, E-stop allowed for every role, shared secret Worker↔sim, SFU app secret never leaves the Worker/sim, email+password accounts (better-auth on D1) gate `/app` and, in production, the live routes | §9 |
| Backend Go / Python FastAPI | Python 3.12 + FastAPI orchestrator; session processes with asyncio + threads; Phase 7 (stretch) adds a Go load generator (`tools/loadgen`) | §5, §10 |
| Frontend React / Next.js | TanStack Start + React 19 + IBM Carbon (exists) | §7 |
| Cloud (AWS/GCP familiarity) | Cloudflare Workers + Durable Objects + Containers + Realtime; §8.4 names the AWS/GCP equivalents | §8 |
| Real-time protocols (WebRTC, WebSocket, gRPC) | WebSocket (control/telemetry), WebRTC (video), Protobuf schemas (gRPC-style contract) | §3, §4 |
| ROS/ROS 2 web tools (Foxglove, ROSBridge) | Foxglove WebSocket bridge from each sim (`/joint_states`, `/sim/stats`, `/camera/*`), MCAP recordings | §5.7 |
| Microservices | `web` (Worker), `relay` (Durable Object), `sim` (container per robot), SFU | §2 |
| Performance analysis | `SimStats` (step ms, render ms, real-time factor, CPU %) in every telemetry frame; browser-side rate/jitter/RTT estimators; Phase 7 (stretch) measures fan-out latency p50/p99 for N viewers | §5.5, §7.7, §10 |
| Observability, CI/CD, incident response | Workers + container logs, `/healthz`, structured JSON logs, GitHub Actions (typecheck, tests, buf lint, deploy), event log in UI | §8.3 |
| Infrastructure as Code | `wrangler.jsonc` (Worker, DO, container, instance type), `docker-compose.yml` | §6.4, §5.10 |
| Automated testing | pytest (task, thermal model, protocol round-trip, model patching for all 25 robots, session WebSocket), vitest (reducer `sync`, live stats); Phase 7 (stretch) adds a Playwright E2E smoke test | §5.11, §7.9, §10 |

## 2. Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser · apps/web (TanStack Start, React 19, Carbon, three.js)"]
    CP["Control page<br/>3D twin · joint wheel/pad · Live controls · Stop"]
    ST["Simulation tab<br/>camera dock · telemetry tiles · joint table · console"]
  end
  subgraph CF["Cloudflare"]
    W["Worker · src/server.ts<br/>/ws/robots/:id · /api/live/* · SSR"]
    DO["Durable Object RobotSession<br/>one per robot: operator lock, fan-out, lifecycle"]
    C["Container RobotSim · apps/sim<br/>FastAPI orchestrator + session process<br/>MuJoCo 500 Hz · aiortc · Foxglove"]
    SFU["Realtime SFU"]
  end
  CP <-- "WebSocket · Protobuf<br/>60 Hz telemetry / targets in Manual hold · Stop" --> W
  W <--> DO
  DO <-- "WebSocket to container :8000" --> C
  C -- "WebRTC publish H.264<br/>STUN/TURN" --> SFU
  SFU -- "WebRTC subscribe" --> ST
  W -- "SFU HTTPS API (app secret)" --> SFU
```

### 2.1 Components

| Component | Tech (pinned) | Location | Role |
| --- | --- | --- | --- |
| Web app | TanStack Start 1.169, React 19.3, @carbon/react 1.119, three 0.186, @bufbuild/protobuf 2.16 | `apps/web` | SSR + Control page; live client; camera subscriber |
| Edge relay | Cloudflare Worker + Durable Object (`RobotSession`, SQLite storage), wrangler 4.153 | `apps/web/src/server.ts`, `apps/web/src/server/robot-session.ts` | Terminates browser WebSockets, enforces operator lock, fans out telemetry, starts/stops the sim container, proxies SFU API |
| Sim orchestrator | Python 3.12, FastAPI, uvicorn, websockets, mujoco 3.17, aiortc 1.15, PyAV, protobuf 7.36, foxglove-sdk 0.30, numpy, psutil, Pillow, httpx, PyYAML, uv | `apps/sim` | Loads the robot's Menagerie model, runs physics, drives the task, publishes telemetry and cameras |
| Contract | Protobuf 3 + buf (`@bufbuild/buf`, `protoc-gen-es`, remote Python plugins) | `proto/noahos/sim/v1/sim.proto` → `apps/web/src/gen/`, `apps/sim/src/noahos/sim/v1/` | One schema for TS and Python; generated code committed |
| Media | Cloudflare Realtime SFU (+ Cloudflare TURN) | SFU app id/secret in Worker and sim env | Fan-out of camera tracks to any number of viewers |
| Compute | Cloudflare Containers, `standard-3` (2 vCPU, 8 GiB), `linux/amd64`, Firecracker microVM | `wrangler.jsonc` `containers[]` | One container per robot, destroyed 60 s after the last viewer leaves (120 s inactivity timeout as backstop) |

### 2.2 Flow of one live session

1. User clicks **Live view** on `/app/robots/unitree_g1`. The browser opens `wss://<host>/ws/robots/unitree_g1?client=<uuid>` and sends `Hello{role: OPERATOR}`.
2. Worker routes the upgrade to `env.ROBOT_SESSION.getByName("unitree_g1")`. The DO starts the container if needed (or, locally, calls the docker-compose orchestrator), `POST /sessions {robot_id}`, opens one WebSocket to the sim, accepts the browser socket with the Hibernation API.
3. The sim session process loads `g1.xml` (patched with cameras and base hold), runs physics at 500 Hz, sends `Welcome` then `Telemetry` at 60 Hz; the DO forwards `Welcome` and every telemetry frame as-is to every browser socket, and sends `SessionInfo` (role, operator) itself.
4. The browser applies telemetry to the three.js twin at animation-frame rate; the Simulation tab subscribes to the cameras through `/api/live/robots/:id/cameras/subscribe` (Worker ↔ SFU) and plays them in `<video>` elements.
5. Going live lands in Manual hold (the sim holds its pose; nothing runs on its own). The operator selects a part and turns its joint: the page sends `JointTargets` (coalesced per animation frame), the DO forwards them (operator, Manual hold only), the sim moves the joint under its position servo and the result comes back as telemetry. **Play** on a policy in the Control tab's **Policies** panel (the list comes from `Welcome.policies`) plays it and locks the joints; **Pause** (or **Manual hold** in the Simulation tab) stops it and holds the pose.
6. **Stop** (header, any role) sends `EStop` — the sim freezes targets at the current pose and reports `MODE_STOPPED` — and ends that browser's live view in the same click. There is no Resume step: the next **Live view** by the operator puts a stopped sim into `MANUAL` (hold the current pose).
7. Last browser leaves → DO alarm after 60 s ends the sim session and destroys the container (§6.3); the container's 120 s inactivity timeout is only a backstop if the DO is evicted first.

## 3. Transport decisions and latency budget

### 3.1 Control and telemetry: WebSocket + Protobuf

- One binary WebSocket per browser, one per robot between DO and sim. Every frame is exactly one `ClientMessage` or `ServerMessage` (Protobuf, no length prefix, no compression: `permessage-deflate` adds latency and telemetry is already ~0.5 KB).
- Protobuf over JSON/MessagePack: packed `repeated float` arrays (4 bytes per value), a shared schema with generated TypeScript and Python types, `oneof` envelopes; decode cost at 60 Hz × 30 joints is well under 0.1 ms in both runtimes. Over FlatBuffers: no zero-copy need at this size, and buf tooling is simpler.
- WebSocket over WebTransport/QUIC: Safari (the user's browser) lacks WebTransport and Workers cannot serve it. Over a WebRTC DataChannel for telemetry: the SFU DataChannel is publish/subscribe with one reply holder, which would complicate the operator lock and fan-out that the Durable Object already gives; TCP head-of-line blocking only matters under packet loss, which is negligible on the edge paths used here.
- Rates: physics `1/timestep` (500 Hz for 23 robots, 250 Hz google_robot, 1000 Hz barkour_v0), telemetry 60 Hz (`SIM_TELEMETRY_HZ`), commands coalesced to ≤60 Hz per client, DO drops client commands beyond 120/s.

### 3.2 Cameras: WebRTC through Cloudflare Realtime SFU

- The sim publishes each camera as an H.264 track (aiortc: libx264 `tune=zerolatency`, Baseline, 1 Mbps default) into one SFU session; browsers subscribe through the Worker (which holds the app secret). Fan-out, congestion control and NAT traversal are the SFU's job; the sim's CPU cost does not grow with viewers.
- Cloudflare Containers accept inbound traffic only through the Worker, so the container must *publish out* to the SFU: ICE servers = `stun:stun.cloudflare.com:3478` plus Cloudflare TURN over TCP/TLS (`turn:turn.cloudflare.com:3478?transport=tcp`, `turns:turn.cloudflare.com:5349?transport=tcp`) so a relay path exists even if UDP egress is unavailable. aiortc/aioice supports `transport=tcp` TURN. TURN is free when used with the SFU.
- Locally (Docker Desktop) the same code path is used: the container publishes to the SFU over the internet, the browser subscribes via the local Worker. One code path, no NAT special-casing.
- Latency is measured in the browser from `RTCPeerConnection.getStats()` (`jitterBufferDelay/jitterBufferEmittedCount`, `framesDecoded`, `totalDecodeTime`) and shown per camera; the sim does not claim a glass-to-glass number it cannot measure.

### 3.3 Pre-decided fallback for cameras

If aiortc cannot keep a connection to the SFU from the container (Phase 3 time-box exhausted), cameras move onto the existing WebSocket: the sim sends `ServerMessage.video_frame { camera, sent_unix_ns, keyframe, data (H.264 Annex-B access unit) }` at the camera fps; the DO relays it like telemetry; the browser decodes with WebCodecs `VideoDecoder` (`codec: "avc1.42E01E"`, Annex-B → `EncodedVideoChunk`) into a `<canvas>`. This gives exact per-frame latency (`sent_unix_ns`) and works everywhere, at the cost of TCP head-of-line blocking under loss and no bandwidth adaptation. Field number 5 in `ServerMessage` is reserved for it (§4).

### 3.4 Latency budget (local Docker on the user's machine; Cloudflare adds one edge round trip ≈ 10–30 ms)

| Hop | Typical | Note |
| --- | --- | --- |
| Physics → telemetry snapshot | 0–16 ms (avg 8) | 60 Hz sampling of a 500 Hz loop |
| Protobuf encode, WebSocket sim→DO→browser | ≤ 2 ms | localhost hops |
| Browser decode + apply on next animation frame | 0–16 ms | rAF coalescing |
| **Telemetry to pixels** | **≈ 25 ms median** | shown as "age" in the HUD |
| Browser command → sim target applied | ≤ 3 ms + one physics step | |
| Camera: render (llvmpipe, 320×240, no shadows/reflections/skybox) | 45–90 ms | measured for G1 in Docker on 2 vCPU; GPU hosts use `MUJOCO_GL=egl` |
| x264 zerolatency + RTP + SFU + decode + jitter buffer | 40–120 ms | SFU adds ~1 RTT to the nearest PoP |

## 4. Wire protocol

File: `proto/noahos/sim/v1/sim.proto`. Generated: `apps/web/src/gen/noahos/sim/v1/sim_pb.ts` (`protoc-gen-es`, `target=ts`), `apps/sim/src/noahos/sim/v1/sim_pb2.py` + `.pyi` (buf remote plugins `buf.build/protocolbuffers/python` and `.../pyi`). Both outputs are committed; `pnpm proto:gen` regenerates.

```proto
syntax = "proto3";

package noahos.sim.v1;

// Framing: one message per binary WebSocket frame, no prefix, no compression.
// Units: radians, metres, seconds, N·m (hinge) or N (slide), watts, °C.

enum Role {
  ROLE_UNSPECIFIED = 0;
  ROLE_OPERATOR = 1;
  ROLE_VIEWER = 2;
}

enum Mode {
  MODE_UNSPECIFIED = 0;
  MODE_AUTO = 1;     // a policy drives the targets
  MODE_MANUAL = 2;   // the operator's targets are held
  MODE_STOPPED = 3;  // E-stop: targets frozen at the current pose, task clock paused
}

enum JointKind {
  JOINT_KIND_UNSPECIFIED = 0;
  JOINT_KIND_HINGE = 1;
  JOINT_KIND_SLIDE = 2;
}

enum EventKind {
  EVENT_KIND_UNSPECIFIED = 0;
  EVENT_KIND_INFO = 1;
  EVENT_KIND_MODE = 2;       // mode changed; Event.mode is set
  EVENT_KIND_ROLE = 3;       // operator changed; Event.operator_id is set
  EVENT_KIND_DENIED = 4;     // command rejected (viewer, or stopped)
  EVENT_KIND_ERROR = 5;
  EVENT_KIND_RECORDING = 6;  // episode recording started/stopped; message carries the file name
}

message ClientMessage {
  oneof msg {
    Hello hello = 1;
    Ping ping = 2;
    JointTargets joint_targets = 3;
    SetMode set_mode = 4;
    EStop estop = 5;
    Recording recording = 6;
  }
}

message ServerMessage {
  // 5 is reserved for VideoFrame (camera fallback over WebSocket, see STACK.md §3.3).
  reserved 5;
  oneof msg {
    Welcome welcome = 1;
    SessionInfo session = 2;
    Pong pong = 3;
    Telemetry telemetry = 4;
    Event event = 6;
  }
}

message Hello {
  string client_id = 1;
  Role role = 2;
  // Send every Nth telemetry frame to this client (1 = full rate). Applied by the relay.
  uint32 telemetry_divisor = 3;
  // Paired devices of one operator: a client whose token equals the lock holder's is granted ROLE_OPERATOR too.
  string pair_token = 4;
}

message Ping {
  string client_id = 1;
  uint64 client_ms = 2;  // Date.now() at send
}

message Pong {
  string client_id = 1;
  uint64 client_ms = 2;
  uint64 server_unix_ns = 3;  // sim wall clock when it answered
}

// Sparse targets: joint_index indexes RobotSpec.joints; target in rad or m.
message JointTargets {
  repeated uint32 joint_index = 1;
  repeated float target = 2;
}

message SetMode {
  Mode mode = 1;  // MODE_AUTO plays a policy, MODE_MANUAL holds the pose
  string policy = 2;  // id from Welcome.policies to play with MODE_AUTO; empty = the selected policy (the first one at session start)
}

message EStop {}

message Recording {
  bool start = 1;
  string task_label = 2;  // free text stored in the MCAP metadata
}

message Welcome {
  string session_id = 1;
  RobotSpec robot = 2;
  Mode mode = 3;
  repeated CameraSpec cameras = 4;
  reserved 5;
  uint32 telemetry_hz = 6;
  repeated PolicySpec policies = 7;
}

message PolicySpec {
  string id = 1;
  string name = 2;
  string description = 3;
  float period_s = 4;  // seconds per cycle (task_cycle / task_phase)
  bool holds_base = 5;  // true: the base is held in the air while it plays; false: the robot stands free on the floor
}

// Sent by the relay (not the sim) on every role change.
message SessionInfo {
  string your_client_id = 1;
  Role granted_role = 2;
  string operator_id = 3;  // empty when nobody holds the lock
  uint32 clients = 4;
}

message RobotSpec {
  string robot_id = 1;
  repeated JointSpec joints = 2;  // hinge and slide joints in MuJoCo joint-id order
  string base_joint = 3;          // name of the free joint, or empty for fixed-base robots
  double timestep = 4;
}

message JointSpec {
  string name = 1;
  JointKind kind = 2;
  bool limited = 3;
  float range_min = 4;
  float range_max = 5;
  bool actuated = 6;
  float effort_limit = 7;  // actuator force/torque limit, N·m or N; 0 = not given by the model
}

message CameraSpec {
  string name = 1;
  uint32 width = 2;
  uint32 height = 3;
  uint32 fps = 4;
  string sfu_session_id = 5;  // publisher session on the Realtime SFU
  string track_name = 6;
}

message Pose {
  float x = 1;
  float y = 2;
  float z = 3;
  float qw = 4;
  float qx = 5;
  float qy = 6;
  float qz = 7;
}

message SimStats {
  float realtime_factor = 1;  // sim seconds per wall second, EWMA over 1 s
  float physics_hz = 2;       // measured step rate
  float step_ms = 3;          // mean mj_step wall time
  float render_ms = 4;        // mean camera render wall time
  float cpu_percent = 5;      // session process CPU (psutil)
}

// Arrays align with RobotSpec.joints.
message Telemetry {
  uint64 seq = 1;
  double sim_time = 2;
  uint64 sent_unix_ns = 3;
  Mode mode = 4;
  repeated float qpos = 5;
  repeated float qvel = 6;
  repeated float torque = 7;        // qfrc_actuator (servo) or qfrc_inverse (kinematic) per joint
  repeated float power_w = 8;       // |torque * qvel|
  repeated float motor_temp_c = 9;  // first-order thermal model, see STACK.md §5.5
  repeated float target = 10;
  Pose base = 11;                   // set when base_joint != "" (held or free)
  optional float battery_percent = 12;  // absent for mains-powered robots
  uint32 contacts = 13;
  float total_power_w = 14;
  SimStats stats = 15;
  uint32 task_cycle = 16;
  float task_phase = 17;            // 0..1 within the current cycle
  bool recording = 18;
  string policy = 19;               // id of the selected policy; it drives targets only in MODE_AUTO
}

message Event {
  EventKind kind = 1;
  string message = 2;
  Mode mode = 3;
  string operator_id = 4;
  uint64 unix_ns = 5;
}
```

### 4.1 Semantics

- **Handshake.** Browser → `Hello` (first message). Relay → `SessionInfo`, then the cached `Welcome` if the sim is already up; otherwise `Welcome` follows when the sim connects. Telemetry starts right after `Welcome`.
- **Roles and lock.** The first client whose `Hello.role == ROLE_OPERATOR` while `operator_id` is empty gets the lock; everyone else is granted `ROLE_VIEWER`. The lock is released when that socket closes; a viewer takes it by sending `Hello{role: OPERATOR}` again ("Take control"). `SetMode` and `Recording` are accepted from the operator only (others get `Event{DENIED}`); `JointTargets` is accepted only from the operator **and only in `MODE_MANUAL`** — the relay refuses it otherwise (`"only the operator can move joints"` / `"a policy is playing: pause it to move joints"`) and the sim applies the same rule for every client (safety: nothing moves joints while a policy plays or after an E-stop); **`EStop` is accepted from any role** (product rule: anyone who sees live state can stop the robot).
- **Paired devices.** A client whose `Hello.pair_token` equals the lock holder's is granted the operator role too (one operator person on several devices: the visionOS app `apps/vision` and the Control page it opens in Safari with `?pair=<token>`); the lock is released when the last of them closes.
- **Modes and policies.** A new sim session starts in `MODE_MANUAL`, holding its initial pose: going live never starts anything. `Welcome.policies` lists what the robot can play (every robot: `sweep` "Joint sweep"; Unitree Go1 and G1 also `walk` "Joystick walk", MuJoCo Playground's learned ONNX locomotion policies, run on the Menagerie model with the training joint gains, damping, armature and friction applied while they play and restored afterwards; a fixed patrol of commands replaces the joystick). The operator plays one with `SetMode{AUTO, policy}` (Control tab, **Policies** panel); playing another switches to it, playing restarts its clock at cycle 0. The sweep holds the base lifted in the air; a walk starts standing on the floor with a free base, and `Telemetry.base` follows it. `JointTargets` are applied only in `MANUAL`; in `AUTO` they are refused with `Event{DENIED,"a policy is playing: pause it to move joints"}`. `EStop` → `STOPPED` (targets := current `qpos`, policy clock paused); while stopped, `JointTargets` is refused with `Event{DENIED,"stopped"}`. `SetMode{MANUAL}` (Pause) holds the current pose, freezing a free base where it stands. Targets are clamped to joint ranges by the sim.
- **Ping/Pong.** Browser sends `Ping` every 1 s; the relay forwards it to the sim; the sim answers `Pong` (echoing `client_id`, `client_ms`); the relay routes the `Pong` to that client by its WebSocket tag. RTT = `Date.now() - client_ms`; clock offset = `server_unix_ns/1e6 - (client_ms + rtt/2)` (EWMA α = 0.3); telemetry age = `Date.now() - (sent_unix_ns/1e6 + offset)`.
- **Fan-out.** The relay forwards `Telemetry` bytes without re-encoding; with `telemetry_divisor = n` it forwards every n-th frame to that client. `Event` and `Welcome` go to all clients; `Pong` to one.
- **Reconnect.** Browser: on an unexpected close, retry with backoff 0.5, 1, 2, 4, 4 s (5 attempts), then `error`. Relay→sim: 3 attempts, 1 s apart, then `Event{ERROR,"sim disconnected"}` and clients are closed with code 1011.
- **Errors.** Unknown or undecodable client frames are dropped and counted; the relay closes a client that sends more than 120 messages/s with code 1008.

## 5. Simulation service (`apps/sim`)

### 5.1 Layout

```
apps/sim/
  pyproject.toml            # name noahos-sim, requires-python >=3.12,<3.13, hatchling, [project.scripts] noahos-sim = "noahos_sim.cli:main"
  .python-version           # 3.12 — same minor as the Docker base; the host has Python 3.15, for which mujoco/PyAV/pylibsrtp wheels may not exist, so uv downloads 3.12
  uv.lock
  Dockerfile
  docker-compose.yml
  robots.yaml               # §5.9
  .env.example              # CF_REALTIME_APP_ID=, CF_REALTIME_APP_SECRET=, SIM_SHARED_SECRET=, SIM_ICE_SERVERS=
  src/noahos_sim/
    cli.py                  # argparse: serve | session | probe
    orchestrator.py         # FastAPI app: /healthz /robots /sessions /sessions/{id}/ws (proxy) /sessions/{id}/episodes
    config.py               # pydantic-settings Settings + robots.yaml loader (RobotConfig, CameraConfig)
    models.py               # Menagerie lookup (MENAGERIE_DIR), XML patching (cameras, base hold) → temp xml next to the original
    session/__init__.py
    session/process.py      # entry for `noahos-sim session`: builds Session, runs the asyncio server on --port
    session/physics.py      # PhysicsThread: pacing, policy/manual/stopped targets, drive, base hold, telemetry snapshots
    policies/               # Policy base, JointSweep (every robot), Go1/G1 joystick walks (ONNX in policies/onnx, Apache-2.0)
    session/drive.py        # ServoDrive (ctrl from targets, PD for motor actuators) / KinematicDrive (qpos + mj_inverse)
    session/telemetry.py    # Telemetry assembly: torque, power, thermal model, battery, stats
    session/cameras.py      # RenderThread + CameraTrack (aiortc VideoStreamTrack) + JPEG for Foxglove
    session/rtc.py          # RtcPublisher: aiortc PeerConnection → Realtime SFU sessions/new + tracks/new, reconnect
    session/ws.py           # websockets server: ClientMessage dispatch, telemetry sender, ping/pong
    session/foxglove_bridge.py  # foxglove.start_server + channels; MCAP recorder (open_mcap)
    logging.py              # JSON formatter for stdlib logging
  src/noahos/sim/v1/       # generated sim_pb2.py / sim_pb2.pyi (+ empty __init__.py in noahos/, sim/, v1/)
  tests/                    # §5.11
```

### 5.2 Process model

- **Orchestrator** (`noahos-sim serve`, uvicorn on `0.0.0.0:8000`, single process): manages sessions. `POST /sessions {robot_id}` spawns `noahos-sim session --robot <id> --port <p> --foxglove-port <f>` as a subprocess (`p` = first free port from 8100, `f` = `p + 900`), waits for `GET http://127.0.0.1:<p>/healthz` (≤ 30 s), returns the session. One session per robot id (idempotent). `WS /sessions/{id}/ws` is a transparent proxy to `ws://127.0.0.1:<p>/ws` (two asyncio tasks copying binary frames), so only port 8000 is exposed. `SIGTERM` stops all sessions. Session subprocess exit → session removed; next `POST` restarts it.
- **Session process** (one robot):
  - `PhysicsThread`: loop at `1/model.opt.timestep` with absolute-time pacing (`next += dt`, sleep until `next`, catch up at most 10 steps then re-base). Each step: compute targets (task / manual / stopped), apply drive, `mj_step`, hold the floating base (§5.3), update thermal/battery state; every `round(physics_hz / telemetry_hz)` steps copy `qpos/qvel/qfrc_actuator/ncon/...` into a `Telemetry` snapshot and `put_nowait` it on a bounded queue (size 2, drop oldest). `mj_step` and `update_scene` share one `threading.Lock`.
  - `RenderThread` (§5.6): per camera at its fps, renders and pushes frames to the camera's track queue and, at ⅓ fps, a JPEG to the Foxglove channel.
  - Main thread, asyncio: `websockets` server on `--port` (`/ws`, `/healthz` via `process_request`), telemetry sender (awaits the queue, encodes, sends), command handling, `RtcPublisher`, Foxglove server, MCAP writer.
  - MuJoCo releases the GIL inside `mj_step`/`mj_forward`/render, so the three threads overlap.
- Scaling story: process-per-session locally (many robots in one container, ports 8100+), container-per-robot on Cloudflare (each container hosts exactly one session). Same binary, same API.

### 5.3 Model loading and patching

- Model root: `MENAGERIE_DIR` (default `/opt/menagerie` in the image; `apps/web/public/models/menagerie` for native dev). Main MJCF per robot comes from `robots.yaml` (same ids and files as `apps/web/src/components/app/fleet-data.ts`).
- `models.load(robot)` opens the main MJCF with `mujoco.MjSpec.from_file` (so `meshdir`, `assetdir` and `<include>` resolve as usual), adds a checker floor, a light and a skybox, adds the cameras below, and compiles. Nothing is written next to the Menagerie files.
- Cameras added (§5.6 for rendering): `third_person` in `<worldbody>`: `<camera name="third_person" mode="targetbodycom" target="<root body>" pos="1.8 -1.6 1.0" fovy="45"/>`; `rear` as a child of the root body: `<camera name="rear" mode="track" pos="-1.2 0 0.6" xyaxes="0 -1 0 0.4 0 0.9"/>` (follows position, fixed orientation looking forward/down); plus any `<camera name=...>` already in the model (op3 `egocentric`, stretch `camera_rgb`, go1 `tracking`, barkour `track`/`realsense/rgb`/`oak/rgb`, aloha's four) and the per-robot extras in `robots.yaml`. Cameras are exposed in config order, at most 4 per robot.
- Floating base (12 robots with a free joint: g1, h1, op3, stretch, a1, go1, go2, anymal_b, anymal_c, barkour_v0, barkour_vb, spot): held kinematically — after every `mj_step`, `qpos[adr:adr+7] = base_pose` and `qvel[dofadr:dofadr+6] = 0`, where `base_pose` is the first keyframe's base pose when the model has keyframes, else `qpos0`, raised by 35 % of its height (and further until every geom clears the floor by 2 cm). Legs then cycle in the air under a fixed body with gravity on, so torques stay real. An unnamed free joint is reported as `free_base`. The UI labels it "base held".
- Initial pose: first keyframe (`stand`/`home`/`standing`/`neutral_pose`) when present, else `qpos0` clamped to joint ranges. Joint list = hinge and slide joints in id order; names from `mj_id2name`.

### 5.4 Task and drive modes

- **Task "Joint sweep"** (every robot): `center[j]` = initial pose; `amp[j]` = `min(0.25 · (range_max − range_min), 0.6)` for limited hinges, `0.5` rad for unlimited hinges, `0.25 · width` (`0.05` m if unlimited) for slides; `target[j](t) = clamp(center[j] + amp[j] · sin(2π·t/T + φ[j]), range)` with `T = period_s` (default 8 s) and `φ[j] = 2π · j / n`. `task_cycle = floor(t/T)`, `task_phase = (t mod T)/T`. Only actuated joints are driven; passive joints follow physics. Task name/description/period come from `robots.yaml`.
- **Servo drive** (default): for each actuator with joint transmission (`actuator_trntype == mjTRN_JOINT`): if it is a position servo (`actuator_biastype == mjBIAS_AFFINE` and `biasprm[1] < 0`) → `ctrl = clip(target, ctrlrange)`; otherwise (plain motors: h1, go2, stretch wheels) → `ctrl = clip(kp·(target − q) − kd·qd, ctrlrange)` with `kp = min(ctrl_max / 0.5, 150)`, `kd = 0.1·kp`. Tendon-driven actuators (panda/xarm grippers) are not commanded.
- **Kinematic drive** (per-robot `drive: kinematic` in `robots.yaml`, used when a servo loop diverges): `qpos := target`, `qvel := (target − prev)/dt`, then `mj_forward` + `mj_inverse`; torque telemetry uses `qfrc_inverse`. Divergence rule for verification: if any driven joint is more than 0.5 rad from its target 2 s after start, switch that robot to kinematic.

### 5.5 Telemetry computations (per joint `j`, DoF `d`)

- `torque[j] = data.qfrc_actuator[d]` (servo) or `data.qfrc_inverse[d]` (kinematic); `power_w[j] = |torque[j] · qvel[j]|`; `total_power_w = Σ power_w`.
- Thermal model (MuJoCo has no motor temperature; labelled "modelled" in the UI): `T[j] += dt · (k_heat · torque[j]² − k_cool · (T[j] − T_ambient))`, `T[0] = 35 °C`, `k_heat = 0.0005 °C/(s·(N·m)²)`, `k_cool = 0.02 /s`, `T_ambient = 25 °C`, clamp 0–120. (30 N·m sustained ≈ +22 °C.)
- Battery (robots with `battery_wh > 0`): `energy_wh += dt · (total_power_w + 20 W idle) / 3600`; `battery_percent = 100 · (1 − energy_wh / battery_wh)`, floor 0. Mains robots omit the field.
- `contacts = data.ncon`. `SimStats`: `realtime_factor` = Δsim_time/Δwall over the last second (EWMA), `physics_hz` measured, `step_ms`/`render_ms` means over the last second, `cpu_percent = psutil.Process().cpu_percent()` sampled once per second.
- `seq` increments per frame; `sent_unix_ns = time.time_ns()` at send.

### 5.6 Cameras

- Headless rendering: `MUJOCO_GL=osmesa` (CPU, Mesa llvmpipe; `libosmesa6` in the image), one `mujoco.Renderer` per resolution, created and used only in `RenderThread`, with shadows, reflections and the skybox switched off (a 4× saving on llvmpipe). Defaults 320×240 @ 10 fps per camera; when the CPU cannot keep up, cameras share the render budget round-robin and the browser shows the real fps (`width/height/fps` per camera in `robots.yaml`, env overrides `SIM_CAMERA_FPS`, `SIM_CAMERA_WIDTH`, `SIM_CAMERA_HEIGHT`; `SIM_CAMERAS_ENABLED=false` disables rendering entirely). On a GPU host set `MUJOCO_GL=egl`.
- Each frame: `renderer.update_scene(data, camera=name)` under the physics lock, `rgb = renderer.render()`, `av.VideoFrame.from_ndarray(rgb, format="rgb24")` with `pts` from the sim clock → the camera's `CameraTrack` (subclass of `aiortc.VideoStreamTrack`; `recv()` awaits an `asyncio.Queue(maxsize=1)`, newest frame wins).
- `RtcPublisher`: **one `RTCPeerConnection` and one SFU session per camera** — aiortc does not complete ICE when the SFU's ICE-lite answer bundles several m-lines, while a single m-line connects reliably. Per camera: `addTransceiver(track, "sendonly")` with H.264 preferred, `createOffer` → `setLocalDescription`, then `POST {SFU}/apps/{appId}/sessions/new` and `POST .../sessions/{id}/tracks/new` with `{sessionDescription: offer, tracks: [{location:"local", mid, trackName: camera}]}` (`httpx`, `Authorization: Bearer CF_REALTIME_APP_SECRET`), `setRemoteDescription(answer)`. When a camera connects or drops, `Welcome.cameras` is rebuilt (each camera carries its own `sfu_session_id`) and re-broadcast with `Event{INFO,"Cameras streaming: …"}`; a failed or timed-out (15 s) connection re-publishes with backoff 1, 2, 4, 8 s. Without `CF_REALTIME_APP_ID` the publisher is skipped and `Welcome.cameras[].sfu_session_id` is empty (UI shows "Camera stream unavailable").

### 5.7 Foxglove bridge and MCAP episodes

- `foxglove.start_server(host="0.0.0.0", port=<foxglove_port>)` per session (Foxglove WebSocket protocol, subprotocol `foxglove.sdk.v1`; open Foxglove → "Open connection" → `ws://localhost:<port>` locally, or the Worker pass-through route on Cloudflare). Besides the channels below, `/sim/telemetry` carries every `Telemetry` frame as Protobuf (schema = the `sim.proto` descriptor set), so recordings hold the exact wire data.
- Channels (one `foxglove.Context` per session): `/joint_states` (JSON schema `{name: string[], position: number[], velocity: number[], effort: number[]}` — the `sensor_msgs/JointState` field names, logged at telemetry rate), `/sim/stats` (JSON of `SimStats` + mode + battery, 5 Hz), `/camera/<name>` (`CompressedImageChannel`, JPEG quality 70 via Pillow, fps/3).
- Episodes: `Recording{start:true}` → `foxglove.open_mcap("/data/episodes/<robot>-<YYYYmmdd-HHMMSS>.mcap")` on the same context (so the same channels are written), metadata `{robot_id, task_label, started_unix_ns}`; `Recording{start:false}` closes it. `Telemetry.recording` reflects the state; `Event{RECORDING}` carries the file name. `GET /sessions/{id}/episodes` lists `{file, bytes, started_unix_ns, duration_s, task_label}`; `GET /sessions/{id}/episodes/{file}` streams the file. `/data` is a compose volume locally and ephemeral disk on Cloudflare (download before the container sleeps; noted in the UI).

### 5.8 REST API (orchestrator, FastAPI, OpenAPI at `/docs`)

| Method, path | Body / response |
| --- | --- |
| `GET /healthz` | `{"status":"ok","sessions":n}` |
| `GET /robots` | `[{id, mjcf, task:{name,description,period_s}, cameras:[{name,width,height,fps}], battery_wh, drive}]` from `robots.yaml` |
| `POST /sessions` | `{robot_id}` → `201 {id, robot_id, ws_path:"/sessions/{id}/ws", foxglove_port, started_unix_ns}` (200 if it already exists; 404 unknown robot) |
| `GET /sessions`, `GET /sessions/{id}` | session list / one session incl. `clients`, `mode` |
| `DELETE /sessions/{id}` | stops the process → 204 |
| `WS /sessions/{id}/ws` | the §4 protocol (proxied to the session process) |
| `GET /sessions/{id}/episodes[/{file}]` | §5.7 |

All routes except `/healthz` require `Authorization: Bearer ${SIM_SHARED_SECRET}` when that variable is set.

### 5.9 Configuration

`robots.yaml` (ids and files match `fleet-data.ts`; `cameras` lists extras beyond the two generic ones; `battery_wh: 0` = mains):

```yaml
defaults:
  camera: { width: 320, height: 240, fps: 10 }
  drive: servo
  thermal: { ambient_c: 25, k_heat: 0.0005, k_cool: 0.02 }
robots:
  unitree_g1: { mjcf: g1.xml, battery_wh: 900, cameras: [{ name: head, body: torso_link, pos: [0.06, 0, 0.42], xyaxes: [0, -1, 0, 0, 0, 1] }] }
  unitree_h1: { mjcf: h1.xml, battery_wh: 900 }
  robotis_op3: { mjcf: op3.xml, battery_wh: 60 }
  google_robot: { mjcf: robot.xml, battery_wh: 1200 }
  hello_robot_stretch: { mjcf: stretch.xml, battery_wh: 300 }
  unitree_a1: { mjcf: a1.xml, battery_wh: 400 }
  unitree_go1: { mjcf: go1.xml, battery_wh: 400 }
  unitree_go2: { mjcf: go2.xml, battery_wh: 500 }
  anybotics_anymal_b: { mjcf: anymal_b.xml, battery_wh: 650 }
  anybotics_anymal_c: { mjcf: anymal_c.xml, battery_wh: 900 }
  google_barkour_v0: { mjcf: barkour_v0.xml, battery_wh: 300 }
  google_barkour_vb: { mjcf: barkour_vb.xml, battery_wh: 300 }
  boston_dynamics_spot: { mjcf: spot.xml, battery_wh: 600 }
  franka_emika_panda: { mjcf: panda.xml, battery_wh: 0, cameras: [{ name: wrist, body: hand, pos: [0, 0, 0.04], xyaxes: [-1, 0, 0, 0, 1, 0] }] }
  franka_fr3: { mjcf: fr3.xml, battery_wh: 0 }
  universal_robots_ur5e: { mjcf: ur5e.xml, battery_wh: 0 }
  universal_robots_ur10e: { mjcf: ur10e.xml, battery_wh: 0 }
  kuka_iiwa_14: { mjcf: iiwa14.xml, battery_wh: 0 }
  ufactory_xarm7: { mjcf: xarm7.xml, battery_wh: 0 }
  rethink_robotics_sawyer: { mjcf: sawyer.xml, battery_wh: 0 }
  ufactory_lite6: { mjcf: lite6.xml, battery_wh: 0 }
  trossen_vx300s: { mjcf: vx300s.xml, battery_wh: 0 }
  trossen_wx250s: { mjcf: wx250s.xml, battery_wh: 0 }
  aloha: { mjcf: aloha.xml, battery_wh: 0 }
  unitree_z1: { mjcf: z1.xml, battery_wh: 0, drive: kinematic }
```

Camera placement rule for the implementer: if a configured camera shows a uniform colour (inside a mesh), move `pos` along the camera's viewing axis in +0.1 m steps until the scene appears, then commit the value.

Environment variables (`pydantic-settings`, prefix none): `MENAGERIE_DIR`, `SIM_DATA_DIR` (default `/data`), `SIM_TELEMETRY_HZ` (60), `SIM_CAMERAS_ENABLED` (true), `SIM_CAMERA_FPS/WIDTH/HEIGHT`, `SIM_SHARED_SECRET`, `CF_REALTIME_APP_ID`, `CF_REALTIME_APP_SECRET`, `SIM_ICE_SERVERS` (JSON array of `{urls, username?, credential?}`; default `[{"urls":"stun:stun.cloudflare.com:3478"}]`; add Cloudflare TURN entries generated with the TURN key API when deploying), `SIM_LOG_LEVEL`, `MUJOCO_GL`.

### 5.10 Docker and compose

`Dockerfile` (multi-stage, `linux/amd64` for Cloudflare; Docker Desktop builds it on Apple Silicon with `--platform linux/amd64` when wrangler asks, natively arm64 for compose):

```dockerfile
FROM python:3.12-slim
ENV MUJOCO_GL=osmesa SIM_DATA_DIR=/data PYOPENGL_PLATFORM=osmesa PYTHONUNBUFFERED=1 MENAGERIE_DIR=/opt/menagerie PATH="/app/.venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends libosmesa6 libgl1 libglu1-mesa git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ARG MENAGERIE_COMMIT=f3b6013629c7b94f8ee93fd977b161fa8350f9bc
RUN git clone --filter=blob:none --no-checkout https://github.com/google-deepmind/mujoco_menagerie /opt/menagerie \
 && cd /opt/menagerie && git sparse-checkout init --cone \
 && git sparse-checkout set unitree_g1 unitree_h1 robotis_op3 google_robot hello_robot_stretch unitree_a1 unitree_go1 unitree_go2 anybotics_anymal_b anybotics_anymal_c google_barkour_v0 google_barkour_vb boston_dynamics_spot franka_emika_panda franka_fr3 universal_robots_ur5e universal_robots_ur10e kuka_iiwa_14 ufactory_xarm7 rethink_robotics_sawyer ufactory_lite6 trossen_vx300s trossen_wx250s aloha unitree_z1 \
 && git checkout $MENAGERIE_COMMIT && rm -rf .git
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY robots.yaml ./
RUN uv sync --frozen --no-dev
RUN mkdir -p /data
EXPOSE 8000
CMD ["noahos-sim", "serve", "--host", "0.0.0.0", "--port", "8000"]
```

If MuJoCo fails to import OSMesa at runtime, add `libosmesa6-dev`. Image ≈ 2.1 GB (Menagerie ≈ 0.53 GB, Python wheels incl. mujoco/av/aiortc ≈ 1 GB); well under the `standard-3` 16 GB disk and the 50 GB account image store.

`docker-compose.yml`:

```yaml
services:
  sim:
    build: .
    ports: ["8000:8000", "9000-9032:9000-9032"]   # orchestrator; Foxglove ports of sessions
    env_file:
      - path: .env
        required: false
    environment: { SIM_DATA_DIR: /data }
    volumes: ["./data:/data"]
    init: true
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 5s
      timeout: 3s
      retries: 12
```

Run: `cd apps/sim && cp .env.example .env && docker compose up --build`. Native dev without cameras: `uv run noahos-sim serve` with `MENAGERIE_DIR=../web/public/models/menagerie SIM_CAMERAS_ENABLED=false`. Probe without the web app: `uv run noahos-sim probe --robot unitree_g1` (creates a session, prints telemetry Hz, RTT, first joint values, sends one `JointTargets`, then `EStop`).

### 5.11 Tests (pytest, `apps/sim/tests`)

- `test_task.py`: sweep targets stay inside ranges for 3 cycles; period matches; phase monotonic.
- `test_thermal.py`: constant torque heats toward the closed-form equilibrium; zero torque cools to ambient.
- `test_protocol.py`: `Telemetry` round-trip through `sim_pb2`; array lengths equal `len(RobotSpec.joints)`; `JointTargets` with out-of-range values is clamped by the session handler.
- `test_models.py` (skipped unless `MENAGERIE_DIR` set): every robot in `robots.yaml` patches and loads; every configured camera exists in the compiled model; floating-base detection matches the 12 expected ids.
- `test_session_ws.py`: start `franka_fr3` with `SIM_CAMERAS_ENABLED=false`, connect with `websockets`, expect `Welcome` then ≥ 10 `Telemetry` within 0.5 s at 60 Hz; `JointTargets` → next telemetry `mode == MANUAL` and the target reflected; `EStop` → `STOPPED` and targets equal `qpos`.
- Lint/type: `ruff check`, `ruff format --check`.

## 6. Edge relay (Worker + Durable Object)

### 6.1 Routes (handled in `apps/web/src/server.ts` before the TanStack Start handler)

| Route | Handler |
| --- | --- |
| `GET /ws/robots/:id?client=<uuid>` (Upgrade) | `env.ROBOT_SESSION.getByName(id).fetch(request)` → DO accepts the socket |
| `POST /api/live/robots/:id/cameras/subscribe` | DO: `POST {SFU}/sessions/new` → `POST .../tracks/new` with `tracks: [{location:"remote", sessionId: <publisher>, trackName}]` for every camera in the cached `Welcome` → returns `{sessionId, sessionDescription (offer), tracks:[{mid, name}]}` |
| `PUT /api/live/robots/:id/cameras/answer` | body `{sessionId, sessionDescription (answer)}` → `PUT {SFU}/sessions/{sessionId}/renegotiate` → 204 |
| `GET /api/live/robots/:id` | `{live, clients, operatorId, mode, cameras}` |
| `GET /api/live/robots/:id/episodes[/:file]` | proxied to the sim (`Authorization` added) |
| `GET /api/live/robots/:id/foxglove` (Upgrade) | pass-through to the sim's Foxglove port (`getTcpPort(foxglove_port).fetch(request)` returned directly) |

`src/server.ts`:

```ts
import handler from '@tanstack/react-start/server-entry'
export { RobotSession } from './server/robot-session'
export default {
  fetch(request, env, ctx) {
    const m = new URL(request.url).pathname.match(/^\/(?:ws|api\/live)\/robots\/([^/]+)/)
    if (m) return env.ROBOT_SESSION.getByName(m[1]).fetch(request)   // production: better-auth session required here (§9)
    return handler.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
```

### 6.2 `RobotSession` Durable Object (`apps/web/src/server/robot-session.ts`, `extends DurableObject<Env>`)

- Browser sockets use the Hibernation API: `ctx.acceptWebSocket(server, [clientId])`, attachment `{clientId, role}` via `serializeAttachment`; `webSocketMessage` decodes `ClientMessage` with `@bufbuild/protobuf` (`fromBinary(ClientMessageSchema, …)`): `hello` → lock logic → `SessionInfo` to all; `ping`/`estop` → forward to the sim; `set_mode`/`recording` → forward if the sender is the operator else `Event{DENIED}`; `joint_targets` → forward only from the operator while the last known mode is `MODE_MANUAL`, else `Event{DENIED}` (§4.1). `webSocketClose` releases the lock, and when no sockets remain sets an alarm 60 s ahead; `alarm()` closes the upstream and ends the sim session if still idle.
- Upstream (one per DO): `ensureUpstream()` is single-flighted. It sends `Hello{client_id:"relay", role: OPERATOR}` after connecting. `message` from the sim: `welcome` → cache (for late joiners and `/cameras/subscribe`) and broadcast; `pong` → route to `ctx.getWebSockets(pong.client_id)`; `telemetry` → broadcast bytes untouched, honouring each client's `telemetry_divisor`; `event` → broadcast. `close` → reconnect ×3 then close clients (1011).
- The upstream socket keeps the DO awake while live; with no clients the alarm tears it down so hibernation and container sleep happen.

### 6.3 Container lifecycle and local override

- Production: `ctx.container.start({ env: { SIM_SHARED_SECRET, CF_REALTIME_APP_ID, CF_REALTIME_APP_SECRET, SIM_ICE_SERVERS, SIM_TELEMETRY_HZ }, enableInternet: true })` when `!ctx.container.running`; `ctx.container.setInactivityTimeout(120_000)`; readiness = `getTcpPort(8000).fetch("http://sim/healthz")` polled every 200 ms (≤ 100 tries); then `POST http://sim/sessions` and the WebSocket upgrade through `getTcpPort(8000).fetch(...)` whose `response.webSocket.accept()` gives the upstream socket. Idle teardown: `DELETE /sessions/{id}` then `ctx.container.destroy()`.
- Local: when `env.SIM_UPSTREAM` is set (`.dev.vars`: `SIM_UPSTREAM=http://localhost:8000`), the same calls go to that origin with global `fetch`; `ctx.container` is never touched, so `dev.enable_containers=false` lets `vite dev` run without Docker-in-wrangler while the sim runs under docker compose.

### 6.4 `wrangler.jsonc` (target)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "noahos",
  "main": "src/server.ts",
  "compatibility_date": "2026-10-23",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "vars": { "APP_ENV": "production", "SIM_TELEMETRY_HZ": "60", "CF_REALTIME_APP_ID": "<app id>" },
  "durable_objects": { "bindings": [{ "name": "ROBOT_SESSION", "class_name": "RobotSession" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RobotSession"] }],
  "containers": [{ "class_name": "RobotSession", "image": "../sim/Dockerfile", "image_build_context": "../sim", "instance_type": "standard-3", "max_instances": 10 }],
  "dev": { "enable_containers": false }
}
```

Secrets (`wrangler secret put`): `CF_REALTIME_APP_SECRET`, `SIM_SHARED_SECRET`, `BETTER_AUTH_SECRET`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`. Bindings: D1 `DB` (`noahos-auth`, schema in `apps/web/migrations/`, `pnpm d1:migrate`), Email Service `EMAIL` (sender `no-reply@noahos.adamgoodapp.com`), Workers AI `AI` (the site assistant: Claude Haiku 5.5 through AI Gateway `main`, which holds the Anthropic key as a stored provider key under the `default` alias, so the Worker has no Anthropic secret; `POST /api/chat` answers only when `APP_ENV=production` and the caller is signed in). Containers require the Workers Paid plan ($5/month). `pnpm cf-typegen` regenerates `Env` after the config change.

## 7. Frontend live mode (`apps/web`)

### 7.1 New and changed files

- `src/server.ts`, `src/server/robot-session.ts` (§6).
- `src/gen/noahos/sim/v1/sim_pb.ts` (generated).
- `src/lib/live/client.ts` — `LiveClient` (WebSocket, protobuf, reconnect, ping, command coalescing, `useSyncExternalStore`-style `subscribe/get`), `src/lib/live/stats.ts` (rate, jitter, RTT/offset, drops, quality), `src/lib/live/cameras.ts` (SFU subscriber: `RTCPeerConnection`, `/cameras/subscribe` → `setRemoteDescription(offer)` → `createAnswer` → gather ≤ 1 s → `/cameras/answer`; `track` events mapped by `transceiver.mid`; `getStats()` sampler at 1 Hz).
- `src/components/app/live-controls.tsx` (header), `camera-dock.tsx`, `simulation-tab.tsx`, `logs-tab.tsx`, `live-tiles.tsx`.
- `src/components/app/control-page.tsx`: wires `useLive(robot.id)`; passes `jointValues = live ? liveValues : values` to `RobotViewer`; sends targets when `values` change while live; enables the Simulation and Logs tabs; replaces placeholder checks/tiles while live.
- `src/components/app/control-state.ts`: add `{ type: 'sync'; values: Record<string, number> }` (sets values, clears `pending`, no history entry).
- `src/styles/app.scss`: `.live-*`, `.camera-dock*`, `.sim-tab*`, `.logs-tab*` classes with Carbon tokens only.
- `apps/web/design/decisions.md`: entries for the Stop control (live mode), the Simulation tab layout (from `design/inspiration/full-page-camera-feed.webp`) and the role lock are appended when those phases ship.

### 7.2 Live client and state

```ts
type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error'
class LiveClient {
  constructor(robotId: string, role: 'operator' | 'viewer')   // clientId from sessionStorage 'noahos.clientId' (crypto.randomUUID())
  connect(): void; close(): void
  setMode(mode: 'auto' | 'manual'): void; estop(): void; record(start: boolean, label?: string): void; takeControl(): void
  subscribe(listener: () => void): () => void
  get(): { status; welcome; session; telemetry; stats; events; error }
}
```

- `useLive(robotId)` wraps it with `useSyncExternalStore`; telemetry is stored per message but `liveValues` for the viewer are derived once per animation frame (`requestAnimationFrame` loop while live) to avoid 60 React renders/s.
- Telemetry → joint values: `welcome.robot.joints[i].name → telemetry.qpos[i]`; base pose → `coordinateKey(base_joint, k)` for `[x, y, z, qw, qx, qy, qz]` (the order `baseValues()` already uses).
- Whenever the page may not control (policy playing, stopped, viewer), it dispatches `sync` with the live values on every 5 Hz publish, so the twin and the side panel show the live pose and Manual hold starts from it.
- In Manual hold (operator), `values` changes (wheel, pad, IK, undo/redo) are diffed against the last sent targets and sent through `LiveClient.sendTargets(changed)` (coalesced per animation frame).

### 7.3 Header controls (`live-controls.tsx`, in `control-head__actions`)

- `idle`: `Button kind="primary" renderIcon={Play}` **Live view** → `connect()`.
- `connecting`/`reconnecting`: `InlineLoading description="Connecting to simulation…"` + `Button kind="ghost"` Cancel.
- `live`: one `Tag size="sm"` with role and mode, **Operator · Manual** (or **Viewer · Playing**, …; green, red when `Stopped`), so the header stays on one row next to the existing disabled Refresh/Share/Save icons; **Stop** `Button kind="danger" renderIcon={StopFilledAlt}` (every role) sends `estop` and leaves live view; pressed while connecting or reconnecting, it shows "Stopping…", keeps reconnecting, sends the E-stop as soon as the socket opens and only then leaves (if the link never comes back, the error says the Stop could not be delivered) — two states only, **Live view** and **Stop**, no Resume; on connecting, an operator who finds the sim `STOPPED` sends `SetMode{MANUAL}` once (hold, no motion); viewers see **Take control** `kind="tertiary"` when `operator_id` is empty. While the link is reconnecting or failed, the health panel shows Comms `failed` (Reconnecting/Disconnected) and the other checks Unknown instead of the placeholders.
- `error`: `InlineNotification kind="error" lowContrast` in the stage with the message and a **Retry** button.
- The record button lives in the Simulation tab (§7.5).

### 7.4 Control tab while live

- **Policies panel** (left panel, `policy-panel.tsx`): Carbon `ContainedList` "Policies" from `Welcome.policies` (before going live: "Go live to list this robot's policies"); each item shows name and description with **Play** (`kind="ghost"`, `renderIcon={Play}`), or **Pause** and a green `Playing` tag while it plays. Only the operator can press them; viewers get "Viewing: only the operator can play policies." Play sends `SetMode{AUTO, policy}`, Pause `SetMode{MANUAL}`.
- **No control while a policy plays (safety).** The 3D twin shows live `qpos`/base; the stage tool bar and the power budget are hidden. Clicking a part selects it and the side panel shows that joint. While a policy plays, when **Stopped**, and for viewers, undo/redo are off and the panel shows the joint without the pad ("Locked"). In **Manual hold** the operator gets the wheel on the selected part, the XY pad (arrow keys 1°, Shift 10°; "All joints follow" IK) and undo/redo; edits become targets. Esc returns the panel to health. The relay and the sim refuse targets outside Manual hold (§4.1). The hint line says which state applies and gains `Tag`s `60 Hz`, `12 ms` (RTT) and `base held` (hidden while a walk plays: the base is free).
- **Live dock** (from the `lg` breakpoint: four across in two rows, floating over the bottom of the 3D view, ≈ 275 px tall — about half the view at 1280×720, a third at 1440×900; between `lg` and `xlg` the cards drop their subtitle and stack the headline under the title; a chevron tab on the dock's top edge hides/shows the analysis cards row (tiles stay); while the dock floats, its height is passed to the viewer, which shifts the projection centre up by half of it and backs off so the robot's current pose fits the uncovered part — on opening/closing the cards and once per sim session when the live pose first arrives; below `lg` the page scrolls and the dock sits under the view; it replaces the tool bar and power budget, layout after the designer's reference): the Power / Signal & latency (quality and RTT in one tile) / Speed / Sim CPU tiles shared with the Simulation tab, then four cards with small bar charts. *Torque load analysis*: each actuated joint's |torque| as a share of its actuator limit (`JointSpec.effort_limit`, from MJCF `forcerange`/`actuatorfrcrange` or motor `ctrlrange`×gear; joints without a limit are left out), peak this session in the tooltip, red at ≥ 90 %. *Joint health*: line of the hottest modelled motor temperature over the last 2 minutes (1 Hz samples) against a dashed 80 °C "Needs service" line, with a dot on the latest value; the note names the hottest joint or counts joints needing service. Every card and tile text is single-line (ellipsis, full text on hover), so changing values never change the dock's height. *Cycle time*: wall time of the last 12 complete task cycles (cycles interrupted by Manual hold or Stop are skipped) against the nominal period, red when > 10 % over. *Daily output*: task cycles completed per UTC day for the last 7 days, counted by the `RobotSession` DO from telemetry into its SQLite storage and served at `GET /api/live/robots/:id/output` (polled every 15 s), so it survives sessions and container restarts.
- **Camera rail** (right panel, live only; replaces the Battery/Latency/CPU tiles, whose numbers live in the dock): one card per camera in `Welcome.cameras` (e.g. G1: third person, rear, head) showing the live WebRTC track, with **Picture in picture** and **Enlarge** buttons in the card's top-right corner. Enlarge opens a passive Carbon modal; picture in picture opens a floating window over the whole page (several at once) that is dragged by its title bar, resized from its bottom-right corner (aspect ratio kept, min 200 px wide, kept inside the viewport) and closed from its header. Open windows belong to the page, not the panel: they stay open when the right panel switches to a joint, across tabs and through a reconnect, and close when live view ends. One SFU subscription per page (`useLiveCameras`) feeds the rail, the PiP windows, the modal and the Simulation tab dock. Not live: the tiles return.
- Right panel (health) uses live values: Comms ⇋ Robot → `succeeded` "RTT 12 ms" / `failed` "disconnected"; Joints → `caution-minor` "3 at limit" or `succeeded` "OK"; Sensors → cameras streaming `n/m`; Battery → `battery_percent` (or Power "Mains"). Tiles: Latency = RTT ms (bar 0–100 ms), CPU = `stats.cpu_percent`, Battery = sim battery.
- Not live: everything stays as it is today.

### 7.5 Simulation tab (enabled; layout follows `design/inspiration/full-page-camera-feed.webp`, Carbon components, DESIGN.md tokens)

- Not live: empty state (`Tile`) "Go live to see cameras and telemetry" with the **Live view** button.
- Live: 
  - **Camera dock** (top, 16:9, max-height 60vh): main `<video autoplay muted playsinline>`; overlays: top-left `Dropdown size="sm"` (camera select) and `Tag` "320×240 · 15 fps · 1.0 Mbps"; top-right `Tag` with the mode ("Controller connected" wording from the reference becomes `Operator connected` / `Viewing`); bottom-left `Tag` session uptime `00:30:10`; bottom-right per-camera `Tag` "jitter buffer 38 ms · decode 3 ms · 0 lost". Thumbnail strip (6 rem tall) with the other cameras; click swaps.
  - **Row** (Carbon `Grid`: lg 6 / 6 / 4): four `StatTile`s **Power** (`total_power_w` W, bar vs 100 W), **Signal** (`Good`/`Degraded`/`Lost` with "60 Hz · jitter 1.2 ms"), **Speed** (max |qvel| rad/s), **Latency** (RTT ms); **Device console** (`ContainedList` of the last 8 events, `HH:MM:SS` + message); **Control mode** (`Manual hold` `Button`, `kind="primary"` while held, else `tertiary`; policies are played from the Control tab) plus **Record episode** (`Button kind="tertiary" renderIcon={RecordingFilled}` toggling `record()`, label input `TextInput size="sm"` for the task label) and the **Episodes** list (`ContainedList` with `Download` links to `/api/live/robots/:id/episodes/<file>`).
  - **Policy progress**: `ProgressBar label="Joystick walk · cycle 12 · Playing" helperText={description} value={task_phase*100}` for the selected policy.
  - **Joint table**: `DataTable size="sm"` with columns Joint, Position (° / mm), Velocity (°/s / mm/s), Torque (N·m / N), Power (W), Temp (°C, "modelled"), Target; rows per `RobotSpec.joints`, updated at 5 Hz (throttled) to keep the table cheap.

### 7.6 Logs tab (enabled)

`DataTable size="sm"` of events (Time, Kind, Message), newest first, max 200 kept, **Clear** button; empty state "No events yet". Connection lifecycle events (`connected`, `reconnecting`, `closed`) are added client-side with `EVENT_KIND_INFO`.

### 7.7 Data-quality HUD (computed in `src/lib/live/stats.ts`)

- Telemetry Hz: messages in a sliding 1 s window, published every 500 ms. Jitter: standard deviation of inter-arrival intervals over the last 60 messages (ms). Drops: Σ `seq` gaps. RTT/offset/age as in §4.1.
- Signal quality: `Good` when Hz ≥ 0.9·`telemetry_hz` and jitter < 8 ms and drops in the window = 0; `Degraded` otherwise; `Lost` when no telemetry for 1.5 s (the Comms check turns `failed`), so the 2 s acceptance in §10 holds with the 5 Hz UI refresh.
- Joints at limit: count of joints with `|qpos − range_edge| ≤ 1e-3` (hinge rad / slide m); the existing per-joint red highlight already shows which.

### 7.8 Stop semantics in the UI

Stop is one click, no confirmation, visible in the header whenever the page is live or connecting, for every role; it halts the robot (E-stop) and ends live view. If another user's Stop halts the robot while you stay live, the mode tag turns red and the stage hint says `Stopped by another user — holding pose`; the operator plays a policy (Policies panel) or presses Manual hold (Simulation tab).

### 7.9 Frontend tests (vitest, new dev dependency)

- `control-state.test.ts`: `sync` sets values, clears `pending`, leaves `past/future` untouched.
- `live-stats.test.ts`: rate/jitter/drop/quality thresholds from a scripted arrival sequence; offset/age math from scripted ping/pong pairs.

## 8. Scaling, cost, operations

### 8.1 Scaling model

| Axis | Mechanism | Limit / note |
| --- | --- | --- |
| Robots | one `RobotSession` DO + one container per robot id | `max_instances` 10 (raise to 25 for the full fleet); account default 1,500 concurrent vCPU |
| Viewers per robot | DO fan-out of the same bytes; `telemetry_divisor` per client; SFU fan-out for video | thousands of hibernatable sockets per DO; at 60 Hz × 0.6 KB a viewer costs 36 KB/s; past ~200 full-rate viewers default new viewers to divisor 2 |
| Sim load per container (`standard-3`) | physics 500 Hz ≈ 6 % of a vCPU for G1 (0.12 ms per step); 3 cameras on llvmpipe use the rest of ~1.5 vCPU at ~7 fps each | reduce fps/resolution/camera count via env; GPU hosts switch to EGL |
| Local (one machine) | process per session under one orchestrator | bounded by CPU; cameras are the cost |

### 8.2 Cost (Cloudflare, beyond included usage)

| Item | Rate | One hour of one live robot |
| --- | --- | --- |
| Container `standard-3` | $0.000020/vCPU-s, $0.0000025/GiB-s | ≈ $0.14 + $0.07 |
| Realtime SFU + TURN egress | $0.05/GB after 1,000 GB/month free | 2 cams × 1 Mbps × viewers ≈ 0.9 GB/viewer-hour → free tier covers > 1,000 viewer-hours |
| Workers/DO | Workers Paid $5/month includes requests, duration and DO usage for this scale | — |

### 8.3 Observability and operations

- Logs: Workers logs for the Worker/DO; container stdout (JSON lines: `ts, level, session, robot, event, …`) via `observability.enabled`. Health: `GET /healthz` on the sim, `GET /api/live/robots/:id` on the Worker. Metrics in-band: `SimStats` in every telemetry frame, HUD estimators in the browser, SFU stats via `getStats()`.
- Incident handling built in: relay reconnects to the sim ×3; browser reconnects ×5; sim re-publishes cameras with backoff; idle teardown; `EStop` is independent of the operator lock.
- CI (`.github/workflows/ci.yml`): `web` (pnpm install, `pnpm typecheck`, `vitest run`), `sim` (uv sync, `ruff`, `pytest` with a sparse Menagerie checkout for `test_models.py`), `proto` (`buf lint`, `buf generate` with pinned plugins, then `git diff --exit-code`), `loadgen` (`go vet`, `go build`), `e2e` (sim image via `docker compose up --wait`, Playwright in Chromium and WebKit, including the outage test). Deploy (`deploy.yml`, on `main`): `pnpm run deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the runner's Docker builds the sim image; deploying from an Apple Silicon Mac instead needs Docker `buildx` with amd64 emulation).
- IaC: `apps/web/wrangler.jsonc` (Worker, DO, container image/instance/limits, vars), `apps/sim/docker-compose.yml`, `apps/sim/Dockerfile`; secrets via `wrangler secret put`.
- Deploy: `cd apps/web && pnpm run deploy` (models fetch → build → `wrangler deploy` builds/pushes the container image for `linux/amd64`). Rollback: `wrangler rollback`.

### 8.4 AWS/GCP equivalents (if the platform changes)

Worker + DO → ALB + a small Go or Node relay service on ECS Fargate / Cloud Run keyed by robot id; Containers → ECS Fargate / Cloud Run (GPU instances allow `MUJOCO_GL=egl`); Realtime SFU → self-hosted LiveKit/mediasoup or keep Cloudflare Realtime; the Protobuf contract and `apps/sim` are unchanged.

## 9. Security

- Browser ↔ Worker: TLS; roles granted by the relay (operator lock, viewer); `EStop` for all roles; `JointTargets` only from the operator in Manual hold; per-client command rate limit; client ids are random UUIDs (no PII).
- Worker ↔ sim: `Authorization: Bearer SIM_SHARED_SECRET` on every orchestrator request and WebSocket upgrade; on Cloudflare the container is reachable only through its Durable Object.
- Media: the SFU app secret is held by the Worker and the sim container only; browsers receive session-scoped SDP, never credentials; publications are joinable only through `/api/live/robots/:id/cameras/subscribe`.
- Authentication: email+password accounts with better-auth on D1 (`src/server/auth.server.ts`, API at `/api/auth/*`). Sign-up sends an activation link through Cloudflare Email Service; the first sign-in requires it; password reset by emailed link. `routes/app/route.tsx` `beforeLoad` redirects signed-out visitors to `/auth/sign-in?redirect=…`; the landing page stays public. With `APP_ENV=production`, `src/server.ts` also requires the session for `/ws` and `/api/live` (401 otherwise) and uses the account name as the operator display name; locally those routes stay open for the visionOS app and the protocol-level e2e tests.

## 10. Implementation phases (build order; each phase ends demoable)

| # | Phase | Scope | Acceptance |
| --- | --- | --- | --- |
| 1 | Contract + sim core | `proto/`, buf generation, `apps/sim` orchestrator + session (physics, task, servo/kinematic drive, telemetry, WS, Dockerfile, compose, tests), no cameras | `docker compose up` then `uv run noahos-sim probe --robot unitree_g1` prints ≈ 60 Hz telemetry, RTT < 5 ms, a joint moves after `JointTargets`, `EStop` → `STOPPED`; `pytest` green for all 25 models |
| 1b | Cloudflare deploy spike (time-box ½ day) | minimal `wrangler.jsonc` containers/DO, `RobotSession` that starts the sim image and holds its WebSocket; a throwaway aiortc ICE probe run inside the container | (a) the DO starts the image and receives telemetry through `getTcpPort(8000)`; (b) aiortc in the container gathers a server-reflexive candidate via `stun.cloudflare.com:3478`, or else a TURN-TCP/TLS relay candidate; (c) cold start of the ≈ 0.9 GB image measured. Outcome picks Phase 3's transport: (b) fails → build §3.3 instead of the SFU path; cold start > 10 s → add the warm-up step in §11 |
| 2 | Edge relay + Control page live | `src/server.ts`, `RobotSession`, `LiveClient`, header controls, Control tab mirroring, right-panel live values, Logs tab, `sync` action, decisions.md entries | In Safari and Chrome: Live view → G1 moves on the page within 2 s; joints are locked during the task, and after Manual hold dragging a joint moves it in the sim and the twin follows; a second tab is a viewer, its Stop freezes the robot in both tabs; operator tab's End live releases the lock and the viewer can Take control |
| 3 | Cameras | `cameras.py`, `rtc.py`, Worker SFU proxy routes, Simulation tab camera dock | two feeds (`third_person`, `rear`) play in Safari and Chrome; moving a joint is visible in the video within ~0.3 s of the twin; per-camera stats shown; fallback §3.3 only if this cannot be reached in the time-box |
| 4 | Telemetry HUD + Simulation tab | tiles, Signal quality, joint table, control-mode buttons, task progress, episodes UI stub hidden until Phase 5 | tiles update live; cutting the sim (`docker compose stop`) turns Signal to `Lost` and Comms to `failed` within 2 s; reconnect restores |
| 5 | Foxglove + MCAP episodes | `foxglove_bridge.py`, record/stop, episodes list/download, Worker proxy routes | Foxglove connects to `ws://localhost:9000` (first session's Foxglove port, §5.2) and plots `/joint_states` and shows `/camera/third_person`; a 20 s recording downloads as `.mcap` and opens in Foxglove |
| 6 | Cloudflare deploy + CI/CD + Access | `wrangler.jsonc` containers/DO, secrets, TURN ICE servers, GitHub Actions, optional Access JWT | `pnpm run deploy` succeeds; `https://<domain>/app/robots/unitree_g1` goes live with telemetry and cameras; the container is destroyed ≈ 60 s after the last viewer leaves |
| 7 | Stretch (after the freeze; stays labelled as design in the deck if not built) | Go load generator `tools/loadgen` (opens N viewer sockets on one robot, reports telemetry fan-out latency p50/p99 from `sent_unix_ns`); Playwright E2E smoke (Live view → telemetry arrives → Stop → `Stopped`) in CI; finished MCAP episodes uploaded to an R2 bucket (`EPISODES` binding) so they survive container sleep | `go run ./tools/loadgen -robot unitree_g1 -n 100` prints p50/p99; Playwright job green in CI; an episode is listed from R2 after the container has slept |

### 10.1 Status (2026-10-30)

| Phase | State | Verified by |
| --- | --- | --- |
| 1 | Done | `noahos-sim probe --robot unitree_g1` against the Docker image: 60 Hz telemetry, RTT 1.6 ms median, joint moved after `JointTargets` (mode `MANUAL`), `EStop` → `STOPPED`; `pytest` 51 passed (all 25 models load, step 2 s, track < 0.5 rad) |
| 1b | **Not done** | needs `wrangler login` and a Workers Paid account (owner chose configure-only); the container's outbound UDP/TURN and cold start are therefore unmeasured |
| 2 | Done | Playwright `e2e/live.spec.ts` passes in **Chromium and WebKit** (Safari's engine): go live into Manual hold (no task starts), telemetry flowing, tool bar/power budget hidden, joint cards locked during the task; Manual hold unlocks them and a card edit becomes the sim's target (Simulation tab joint table); Auto task locks them again; the viewer's Stop freezes both pages, Resume (operator only) returns to Auto task, End live restores the tools and releases the lock, the viewer takes control. Raw WebSocket clients: `JointTargets` refused while the task runs (sim stays `AUTO`) and from a viewer, accepted from the operator in Manual hold. Real Safari.app not run |
| 3 | Done except latency | three G1 cameras published from the Docker image to Cloudflare Realtime and played in Chrome and WebKit (jitter buffer 7–41 ms, decode 1–5 ms, 0 lost) at ~6–7 fps each on 2 vCPU llvmpipe. **"Visible within ~0.3 s of the twin" is not measured**; by the budget (frame interval up to 150 ms + render 45 ms + encode + jitter buffer) it is likely 0.2–0.3 s and fails above that on slower CPUs |
| 4 | Done | Playwright outage test (both engines): `docker kill` of the sim → Signal `Lost` after ~1.3 s and Comms `Disconnected`; after `docker start` the relay reconnects and Signal leaves `Lost` without a reload |
| 5 | Done | a 20 s episode recorded through the relay downloads through the Worker as MCAP (20.0 s; 1,201 `/joint_states` + 1,201 `/sim/telemetry` messages, 48 JPEGs per camera); Foxglove protocol answers both directly on `ws://localhost:9000` and through the Worker route `/api/live/robots/:id/foxglove`. Opening the files in the Foxglove app itself was not done |
| 6 | Deployed, now offline | ran in production on 2026-11-03 (taken offline 2026-11-04) via `pnpm run deploy` (`wrangler deploy` of the Worker, the `RobotSession` Durable Object and the sim Container image), with better-auth accounts on D1 and the AI assistant through AI Gateway. The GitHub deploy workflow is written but lacks repository secrets; Access JWT check implemented, not exercised |
| 7 | Partly done | `tools/loadgen` (Go): 100 viewers on G1 through the local relay → 53.6 Hz per viewer, 0 drops, fan-out latency p50 5.9 ms / p90 31 ms / p99 311 ms (workerd dev + Docker VM networking). Playwright smoke is in CI. **R2 episode upload not built**: needs an R2 bucket and an `EPISODES` binding on the account, i.e. Phase 6 first |

Differences from the first plan (the sections above already describe the build): MjSpec instead of patched XML files (§5.3); held bases lifted clear of the floor (§5.3); `unitree_z1` uses the kinematic drive (§5.4 divergence rule); one SFU session per camera (§5.6); cameras render at 10 fps without shadows/reflections (§5.6); `Lost` after 1.5 s (§7.7); the relay re-announces control changes as `Event{ROLE}`; `src/server.ts` uses TanStack Start's `createServerEntry` and `env` from `cloudflare:workers` rather than the `fetch(request, env, ctx)` form in §6.1.

Telemetry stays at 60 Hz in the sim with three cameras streaming (measured through the relay). Browsers without GPU acceleration (the automated test browsers) can show lower Hz and higher RTT because rendering the twin occupies the main thread; judge HUD numbers in a normal, visible browser tab.

## 11. Demo flow (10 minutes)

Before the meeting (deployed demo): open `/app/robots/unitree_g1` and press **Live view** once, so the container is warm; it is destroyed 60 s after the last viewer leaves (§6.3), so keep one tab live until the demo starts.

1. Dashboard → Unitree G1 → **Live view**: the robot is live and holding its pose (nothing starts on its own); Signal & latency, Sim CPU and the analysis cards fill in.
2. Click the left elbow and turn it with the wheel → the sim follows. In the **Policies** panel press **Play** on **Joystick walk**: the robot stands on the floor and walks its patrol (forward, turn around), the joints lock; **Pause** freezes it where it stands and unlocks them; **Play** on **Joint sweep** lifts it back and sweeps.
3. With a policy playing, open the Simulation tab: camera feeds, power/temperature rising in the joint table, device console, the policy's cycle progress.
4. Second browser window as viewer: shows the same state; press **Stop** there → the robot freezes for both and the viewer leaves live view; the operator presses **Stop** too, then **Live view** again → the robot holds its pose (no Resume step), **Play** restarts a policy.
5. Record a 20 s episode → download the MCAP → open in Foxglove next to the live bridge.
6. Show `STACK.md` §2 diagram and `wrangler.jsonc`: one container per robot, DO fan-out, SFU fan-out; then the deployed URL.

## 12. Decisions

| Decision | One-line why |
| --- | --- |
| WebSocket + Protobuf for control/telemetry | lowest-latency path that works in Safari and on Workers, schema shared across TS/Python, DO gives lock + fan-out for free |
| WebRTC via Cloudflare Realtime SFU for cameras | viewer fan-out without sim cost, UDP/TURN handled by the SFU, the only WebRTC path reachable from Cloudflare Containers |
| One container per robot, one DO per robot | isolation, predictable CPU, sleep-to-zero, simple routing by robot id |
| Servo drive with kinematic fallback | real actuator forces and contacts in telemetry; fallback keeps every one of the 25 models demoable |
| Floating base held kinematically | no balance controller needed; legs still move under physics; honest "base held" label |
| Process per session in the orchestrator | GIL-free parallelism between robots locally, same code as the one-session container |
| Generic "Joint sweep" task | one trajectory generator covers all 25 robots; task metadata lives in `robots.yaml` |
| Modelled motor temperature, battery | MuJoCo has none; labelled as modelled so the UI stays honest |
| Foxglove bridge + MCAP instead of a ROS 2 node | same web-tool value for the JD, no ROS build in the container, MCAP is ROS 2-compatible |
| Protobuf code generated and committed | Cloudflare deploy needs no buf; `buf generate --diff` check in CI keeps it honest |
