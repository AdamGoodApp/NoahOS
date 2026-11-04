## 2026-10-28 · Users are researchers and developers maintaining, controlling, training, and analysing their own robot fleets
- Decided by: the designer
- Why: stated as the app's audience and jobs at context intake.
- Rejected: enterprises as an app audience.
- Rests on: designer's brief.

## 2026-10-28 · The first release covers all four jobs: fleet maintenance, control, training, and data analysis
- Decided by: the designer
- Why: answered at context intake.
- Rejected: a single-job first release.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · A fleet holds up to hundreds of robots
- Decided by: the designer
- Why: answered at context intake.
- Rejected: designing for a handful or dozens of robots.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · Direct control (teleoperation) runs in the browser
- Decided by: the designer
- Why: answered at context intake.
- Rejected: commands and tasks only.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · People work only on fleets they have permission for
- Decided by: the designer
- Why: answered at context intake. Fleets are shared beyond their owner, so access is granted per fleet.
- Rejected: one owner per fleet with no shared access.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · Roles separate viewing from moving robots
- Decided by: the designer
- Why: someone who only watches or analyses a fleet should never be able to move a robot near people.
- Rejected: one role with full access to everything in a fleet.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · Training belongs with data rights, not with motion rights, and access admin is a separate role
- Decided by: Claude (default)
- Why: training runs on compute and never moves hardware, so grouping it with driving would force motion rights onto people who only train. Data rights carry the APPI and open-dataset consent risk; motion rights carry the physical risk; granting access is a third, separate power.
- Rejected: training under Operator; admin as a superset of Operator.
- Rests on: the motion and data defaults in this log.

## 2026-10-28 · Every role that sees a robot's live state can stop it; only Operator can restart motion
- Decided by: Claude (default)
- Why: the person who sees a robot heading toward someone may hold only Viewer access, and stopping is always safe while moving is not. Anyone can stop; only authorised people can start.
- Rejected: Stop as an Operator-only right.
- Rests on: the default that robots operate near people; ethical stance "Physical safety comes before speed".

## 2026-10-28 · Contributing fleet data to an open dataset is an Admin decision, gated by consent from the people shown
- Decided by: Claude (default)
- Why: under Data, a visiting researcher could publish the fleet owner's data outside the organisation. Footage of people sent to a third party needs their consent under APPI.
- Rejected: sharing as a Data right; a separate Publish role, which adds a fifth role for an action with one natural owner.
- Rests on: ethical stance "Data stays with whoever collected it"; APPI.

## 2026-10-28 · NoahOS is open source
- Decided by: the designer
- Why: answered at context intake.
- Rejected: paid.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · The app shows where a fleet's data is stored and who runs that storage
- Decided by: Claude (default)
- Why: with two hosting models, the party responsible for robot data and footage of people under APPI differs per fleet, and people cannot judge consent or retention without knowing it.
- Rejected: leaving hosting invisible in the app.
- Rests on: ethical stance "Data on people is minimised"; APPI.

## 2026-10-28 · The app ships in English
- Decided by: the designer
- Why: answered at context intake; "for now", so other languages may follow.
- Rejected: Japanese, or both, at first release.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · The robots operate near people
- Decided by: Claude (default)
- Why: researchers and developers run fleets in labs and shared spaces, and designing for people nearby is the safer assumption.
- Rejected: assuming isolated or caged operation, which would permit lighter safeguards on commands.
- Rests on: no product source states where the robots operate.

## 2026-10-28 · Robot motion never fires from one accidental input, and stop is always one action away without confirmation
- Decided by: Claude (default)
- Why: the robots operate near people, so an unintended motion is a physical harm, while a delayed stop costs more than an accidental stop.
- Rejected: confirmation on stop, because it slows the one action where speed is the safety; confirmation on every command, because it trains people to click through dialogs.
- Rests on: the default that the robots operate near people. No product source states where they operate.

## 2026-10-28 · Every live value shows its age, and stale data is shown as stale
- Decided by: Claude (default)
- Why: telemetry over real networks lags and drops, and acting on an old value that looks current is a control failure.
- Rejected: showing the last known value without an age, which looks clean but hides the risk.
- Rests on: Intent principle "Design for real conditions".

## 2026-10-28 · Accessibility baseline is WCAG 2.2 AA
- Decided by: Claude (default)
- Why: no product-specific standard was given, and AA is the current baseline.
- Rejected: WCAG 2.1 AA, which is superseded.
- Rests on: no accessibility requirement recorded.

## 2026-10-28 · Success is measured by jobs completed and incidents avoided, with no engagement metrics
- Decided by: Claude (default)
- Why: a fleet tool succeeds when people finish their work and robots behave as intended; time in the app rewards friction.
- Rejected: DAU, session length, and other engagement measures.
- Rests on: Intent principle "Ethical defaults".

## 2026-10-28 · Artifacts this project will make
- Decided by: Claude (default)
- Why: each follows from an answer at intake. /blueprint, because control and telemetry run through backstage systems (robots, network, training compute) the user never sees. /organize, because the app holds four jobs (fleet, control, training, data) that need one structure. /journey for the fault-to-recovery and data-to-training-run flows, because those are the success measures. /fortify for control under lag and disconnect, because a stale view of a moving robot is the highest-harm failure. /include and /measure follow the WCAG 2.2 AA baseline and the success measures.
- Rejected: /localize for now; the language needs are unanswered (UI language is not yet decided).

## 2026-10-28 · The competitor set is Formant, InOrbit, Viam, Foxglove, Rerun, Transitive, LeRobot/LeLab, Open-RMF, Weights & Biases, and the retired AWS RoboMaker
- Decided by: Claude (default)
- Why: together they cover the four jobs (fleet, control, training, data) plus the open-source and self-hosting position; RoboMaker shows the risk of depending on a hosted platform.
- Rejected: simulators (NVIDIA Isaac, Gazebo) and AI log-debugging startups (Alloy, Roboto) as competitors; they are adjacent to the four jobs. Alloy is cited only as evidence of current debugging practice.

## 2026-10-28 · Browser teleop ships with no control without live video, a dead-person switch, and a lag cut-off; the threshold is left to /fortify
- Decided by: Claude (default)
- Why: these are the safeguards people already meet in browser teleop, and the robots operate near people.
- Rejected: adopting Transitive's 500 ms threshold unexamined; leaving safety to the person driving.
- Rests on: Transitive Remote Teleop (https://transitiverobotics.com/caps/transitive-robotics/remote-teleop); the default that robots operate near people.

## 2026-10-28 · Data is checked for quality when it is recorded, before contribution
- Decided by: Claude (default)
- Why: the defects in shared datasets (missing task descriptions, ambiguous camera names, broken episodes) are made at capture time.
- Rejected: curating after upload.
- Rests on: Hugging Face, LeRobot Community Datasets (https://huggingface.co/blog/lerobot-datasets).

## 2026-10-28 · Primary research is skipped; design proceeds to /organize on the context, the landscape, and logged defaults
- Decided by: the designer
- Why: answered after the landscape.
- Rejected: /investigate interviews with researchers and developers before structuring the app.
- Rests on: designer's answer, 2026-10-28. How often each of the four jobs happens stays unmeasured, so /organize weighs them using the landscape's sources only.

## 2026-10-28 · Phase 1 includes deploying a trained model back to robots, as an Operator action
- Decided by: Claude (default)
- Why: without it the loop from fault to fix ends at a trained model nobody can run, and competitors (Viam) already deploy and roll back models like code. A deployed model moves hardware, so it sits with motion rights, not data rights. Staged rollout, rollback, and Stop during a rollout are /fortify work.
- Rejected: stopping Phase 1 at training and tracking runs; deployment as a Data right, which would let someone without motion rights move robots near people.
- Rests on: decisions.md, Roles separate viewing from moving robots.

## 2026-10-28 · Phase 1 defers a Japanese interface, simulation, multi-robot traffic coordination, and AI fault diagnosis
- Decided by: Claude (default)
- Why: the designer set English for now; simulation and traffic coordination sit outside the four jobs (Open-RMF already covers traffic); AI diagnosis builds on the fault-to-recording loop and needs that loop first.
- Rejected: including any of them in the first release.

## 2026-10-28 · The first release ships by 31 October 2026, approved by the designer
- Decided by: the designer
- Why: answered after the brief ("within this month").
- Rejected: a later date.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · The first release covers full scope with no fixed date; the 31 October date is withdrawn
- Decided by: the designer
- Why: answered when shown that the full scope, including its safety work, could not ship in three days.
- Rejected: a view-only release by 31 October, with or without Stop; keeping the 31 October date.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · The first release runs only on Cloudflare; self-hosting on organisations' own servers comes later
- Decided by: the designer
- Why: answered when asked what the app runs on.
- Rejected: self-hosted in the first release.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · Training runs execute on Runpod
- Decided by: the designer
- Why: answered when asked where GPU compute for training comes from; Cloudflare does not provide it.
- Rejected: users' own GPUs; another GPU provider.
- Rests on: designer's answer, 2026-10-28 ("runpod inference").

## 2026-10-28 · Fleet data is stored in the region closest to the user
- Decided by: the designer
- Why: answered when asked where fleet data, including footage of people, lives.
- Rejected: a single fixed region.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · No separate consent is collected for storing or processing footage of people outside Japan, for now
- Decided by: the designer
- Why: answered when asked whether APPI requires consent or contract terms for cross-border handling.
- Rejected: collecting consent for cross-border storage or processing in the first release.
- Rests on: designer's answer, 2026-10-28. Not reviewed against APPI's cross-border transfer rules. Footage of Japanese subjects leaves Japan when a fleet's region is outside Japan, or when simulations on Runpod are built from real recordings.

## 2026-10-28 · Each fleet's data lives in one region, chosen when the fleet is created, closest to the owning organisation
- Decided by: Claude (default)
- Why: "closest to the user" has no single answer for a fleet whose users are in different countries, and Cloudflare R2 keeps each bucket in one region rather than following the viewer. One region per fleet gives "each fleet shows where its data is stored" a single answer.
- Rejected: per-viewer placement; replicating data to every viewer's region.
- Rests on: the designer's answer that data is stored closest to the user.

## 2026-10-28 · Where training on fleet data runs is parked
- Decided by: the designer
- Why: "don't worry about training now". Training stays in Phase 1 scope; its compute is decided later.
- Rejected: settling training compute before /organize.
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · Runpod only runs simulation for training; simulation moves into Phase 1 scope
- Decided by: the designer
- Why: clarified "runpod inference": Runpod is just for running simulation for the training model. Deployed models therefore do not run inference on Runpod.
- Rejected: Runpod as the place deployed models run; simulation as a deferred feature (the earlier default deferring it is overturned).
- Rests on: designer's answer, 2026-10-28.

## 2026-10-28 · DESIGN.md governs the app only, with Geist Mono as the single typeface and "The Lab Bench" as its north star
- Decided by: the designer
- Why: chosen when documenting the design system.
- Rejected: JetBrains Mono; "The Mission Console" and "The Field Notebook".

## 2026-10-28 · DESIGN.md values are measured from screenshots: colours by pixel sampling, sizes, radii and spacing estimated
- Decided by: Claude (default)
- Why: the app has no code yet; colours were sampled from builder.webp and full-page-camera-feed.webp, while type sizes (11/13/20/22px), radii (6/8/12px) and spacing (4–24px) were estimated against the rendered screen width.
- Rejected: leaving tokens empty until /app is built.
- Rests on: re-run /impeccable document once /app has code.

## 2026-10-28 · The dashboard maps a marketplace grid onto the fleet: status filters, site chips, battery range, and robot cards showing battery, status, operator and last-seen age
- Decided by: Claude (default)
- Why: the designer asked for the same grid and layout as a fleet view; every live value shows its age (ethical stance "The state shown is honest"), and a fault takes the orange label the screenshot used for "Free".
- Rejected: price, author and comment counts; robot product images (no robot photos exist, and generated renders were not approved), so each card shows a Panel Grey slot with the model name.

## 2026-10-28 · Data, Training and Docs tabs and the Add robot button are shown but disabled until those surfaces exist
- Decided by: Claude (default)
- Why: they keep the screenshot's layout without links or actions that do nothing.
- Rejected: links to empty pages; hiding them.

## 2026-10-28 · The app is built on IBM Carbon (@carbon/react, white theme), replacing the "Lab Bench" system
- Decided by: the designer
- Why: DESIGN.md was replaced with an IBM Carbon system; the dashboard keeps its sections (filter sidebar, header, search toolbar, robot grid that alone scrolls).
- Rejected: the Lab Bench tokens, Geist Mono and the .impeccable/design.json sidecar, all removed.
- Rests on: DESIGN.md.

## 2026-10-28 · Carbon styles load only on /app; IBM Plex comes from IBM's CDN
- Decided by: Claude (default)
- Why: Carbon's global reset would restyle pages outside /app, and the bundled Plex path ("~@ibm/plex") does not resolve under Vite.
- Rejected: a global Carbon import; self-hosting Plex from node_modules.
- Rests on: carbon-builder guardrails (IBM CDN only).

## 2026-10-28 · Only Dashboard appears in the header navigation; the Data, Training and Docs tabs are removed until those surfaces exist
- Decided by: Claude (default)
- Why: Carbon's header menu has no disabled item, and links to unbuilt pages are dead ends. This overturns the earlier disabled-tabs entry.
- Rejected: disabled tabs styled by overriding Carbon internals; links to empty pages.
- Rests on: DESIGN.md; carbon-builder guardrails (no .cds-- overrides).

## 2026-10-28 · Robot status uses Carbon status icons: fault = failed, online = succeeded, charging = in progress, idle = not started, offline = unknown
- Decided by: Claude (default)
- Why: Carbon requires IconIndicator for status rather than coloured tags; each status needs a shape as well as a colour.
- Rejected: coloured tags; the previous orange/green dots.
- Rests on: carbon-builder guardrails.

## 2026-10-29 · The placeholder fleet is one robot per MuJoCo Menagerie model, excluding bipeds, grippers and hands, drones and biomechanical models (25 robots)
- Decided by: the designer
- Why: the dashboard should show the robots users will control; each card will later open that robot's control page.
- Rejected: the earlier placeholder fleet and the grey image slots.
- Rests on: MuJoCo model gallery (https://mujoco.readthedocs.io/en/stable/models.html).

## 2026-10-29 · Fixed arms show "Mains" instead of a battery level; the Model filter becomes a Type filter (humanoid, mobile manipulator, quadruped, arm)
- Decided by: Claude (default)
- Why: the arms in the list run on mains power, so a battery percentage would be invented; with 25 distinct models, filtering by type is the useful grouping.
- Rejected: showing 100% for arms; a 25-item model checklist.
- Rests on: MuJoCo Menagerie model list.

## 2026-10-29 · Menagerie preview renders are self-hosted, resized to 800px WebP
- Decided by: Claude (default)
- Why: the originals are 4K PNGs (47 MB in total); self-hosting avoids hotlinking GitHub. All 25 models are under permissive licences (BSD-3-Clause, BSD-3-Clause-Clear or Apache-2.0), which require the copyright notice and licence text to ship with the files; each licence is copied to public/img/menagerie/licenses/, and NOTICE.md there marks the images as modified (resized, converted to WebP).
- Rejected: hotlinking raw.githubusercontent.com; shipping the 4K files.
- Rests on: google-deepmind/mujoco_menagerie, per-model LICENSE files.

## 2026-10-29 · The Control page renders the robot with plain three.js in an imperative scene class, loaded only in the browser
- Decided by: Claude (default)
- Why: one canvas with orbit controls, picking and a few overlays does not need a React renderer for three.js; keeping the scene outside React avoids a second dependency and server-rendering problems on Cloudflare Workers.
- Rejected: react-three-fiber; rendering the scene on the server.
- Rests on: three.js OrbitControls, STLLoader, OBJLoader.

## 2026-10-29 · Menagerie model files are downloaded by script into public/models/menagerie/ and deployed as static files, not committed
- Decided by: Claude (default)
- Why: the 25 models are about 0.5 GB of meshes; every file is under Cloudflare's 25 MiB static-asset limit. `pnpm models:fetch` pins the Menagerie commit and skips files already present; the deploy script (`pnpm run deploy`; plain `pnpm deploy` is pnpm's own workspace command) runs it before building so a deploy never ships without models. Textures are skipped because the viewer colours parts by their MJCF rgba.
- Rejected: committing the meshes; hotlinking raw.githubusercontent.com.
- Rests on: google-deepmind/mujoco_menagerie (commit f3b6013), per-model licences.

## 2026-10-29 · Joints move singly (Control joint: wheel, pad, joint cards) or as a chain (Move joint, or the pad with "All joints follow")
- Decided by: the designer (wheel, pad and stats layout from the reference; pad aims the part; part turns red at a limit), Claude (mapping details)
- Why: joint values are what the sim and the real robot accept, and they stay within each joint's MJCF limits. Selecting Control joint swaps the right panel from health checks to the selected joint: name, an "At limit" tag, centre of mass, mass moved and static gravity torque (computed from the model's masses; "—" when the model has none), and the pad. On the wheel and the pad the handle points where the part points on screen (pivot to its centre of mass); dragging turns the part after the pointer, so the two always agree. A slide joint follows the handle's height. The wheel's solid arc is the joint's range and the dashed arc is out of reach. While the joint sits on a limit, the selected part, the wheel's handle and its limit ticks turn red. Stat labels describe what is computed, not the reference's copy. Joint cards use a number input because Carbon's slider does not fit an 18rem panel.
- Rejected: dragging the part sideways in the 3D view to turn one joint; pad as two joints at once or as a joystick; Carbon Slider in the cards; a separate Select tool (Control joint selects).
- Rests on: MJCF joint ranges; Carbon NumberInput.

## 2026-10-29 · Move joint drags a part and the joints between it and the base follow (inverse kinematics)
- Decided by: the designer (tool, and the pad's "All joints follow" toggle, off by default), Claude (solver)
- Why: posing an arm or leg by where its end should go is faster than joint by joint. Dragging a part in the 3D view moves its centre across the screen's plane; the pad with the toggle on does the same by how far the pointer travels from where it pressed. Every hinge and slide joint from the part down to the base (or to a floating body such as a quadruped's torso) turns within its limits; cyclic coordinate descent, at most 0.35 rad per joint per step. One drag is one undo step.
- Rejected: moving the part along a fixed world plane; chains that pass through a floating base.
- Rests on: MJCF joint ranges.

## 2026-10-29 · Control-page actions that need the sim are shown disabled; "Add component" and the per-panel ⋮ menus from the reference are not built
- Decided by: Claude (default)
- Why: follows the existing rule that controls leading nowhere are shown disabled (Overview, Behaviour, Simulation and Logs tabs; Rename, Refresh, Share, Save pose, Live view; update actions; joint filter). A real robot's parts cannot be added from this page, so "Add component" has no equivalent.
- Rejected: live-looking controls that do nothing.
- Superseded 2026-10-30 for Live view and the Simulation and Logs tabs, which now work (see the live-view entries below); the rest of this entry still holds.
- Rests on: the dashboard's disabled-control decision.

## 2026-10-29 · The Control page's placeholder health data follows the robot's dashboard status
- Decided by: Claude (default)
- Why: "the state shown is honest". A fault robot shows its fault on the Joints check; an offline robot shows comms as unknown with its last-seen age, other checks as unknown, battery as last known and latency/CPU as "—". The page header repeats the dashboard's status and age.
- Rejected: all-green checks and fixed readings for every robot.

## 2026-10-30 · Live view: Stop is in the header for every role, one click, no confirmation; Resume needs the operator
- Decided by: Claude (default, from the product rule "Stop must be one action away on any surface that can move a robot")
- Why: anyone who sees live state can stop the robot, so the red Stop button sits in the header next to the role and mode tags whenever the page is live, for operators and viewers alike, and the Simulation tab repeats it in Control mode. While stopped the header shows Resume (operator only; returns to the mode in force before the stop) and the stage hint reads "Stopped — holding pose".
- Rejected: a confirmation dialog on Stop; Stop only for the operator.
- Rests on: STACK.md §4.1 (EStop accepted from any role), §7.3, §7.8.

## 2026-10-30 · One operator per robot; everyone else views until control is free
- Decided by: Claude (default)
- Why: two people driving the same joints would fight each other. The first browser to go live holds the operator lock; later ones are viewers whose edits are not sent and whose page follows the live pose. When the operator ends live view, viewers get Take control. Control changes appear in the device console and the Logs tab.
- Rejected: last-writer-wins control; a request/approve handover (no accounts yet).
- Rests on: STACK.md §4.1, §6.2.

## 2026-10-30 · The Control page mirrors the sim while live; edits become joint targets
- Decided by: Claude (default)
- Why: the 3D twin shows the sim's pose every animation frame. Outside manual control the joint cards and wheel follow the live pose; the operator's first edit (card, wheel, pad, Move joint, pose, undo/redo) switches the sim to Manual and sends targets. Health checks and the Battery/Latency/CPU tiles show live values (battery and motor temperature are labelled modelled). The disabled Refresh/Share/Save placeholders stay where they are; to fit the header, role and mode share one tag ("LIVE · Operator · Manual") and End live is an icon button. Everything returns to the earlier placeholders when live view ends.
- Rejected: a separate live page; sending every value on connect (it would yank the robot to the page's pose).
- Rests on: STACK.md §7.2, §7.4.

## 2026-10-30 · Simulation tab follows the full-page camera layout; Logs tab is a plain event table
- Decided by: the designer (layout reference: the full-page camera feed), Claude (Carbon mapping and contents)
- Why: the camera feed leads, with camera select, resolution/fps and role on top, session uptime and stream stats at the bottom, thumbnails of the other cameras below; then Power/Signal/Speed/Latency tiles, the device console and Control mode (Auto task, Manual hold, Stop, Record episode, Episodes), then task progress and the per-joint table (5 Hz). Without Realtime credentials the dock says "Camera stream unavailable" instead of showing a fake feed.
- Rejected: the reference's map tile and Speak/Grab/Film/Search modes (no equivalent in the sim).
- Rests on: STACK.md §7.5, §7.6.

## 2026-10-30 · Live view hides the stage toolbar and the power budget
- Decided by: the designer
- Why: while live the stage shows the sim; the bottom tool bar (Camera, Control joint, Move joint, undo/redo, reset view) and the placeholder power budget are hidden. They return when live view ends.
- Rests on: designer request.

## 2026-10-30 · Live view is read-only: no joint control from the browser
- Decided by: the designer (safety)
- Why: while live nobody can move the robot's joints from the page. The tool bar and power budget are hidden; joint cards are disabled and show live values; poses and undo/redo are off; the wheel, XY pad and Move joint drag are gone. Clicking a part or a joint card still selects it and shows that joint's details (value, range, load) in the side panel; Esc returns the panel to the live health checks. The relay also refuses joint commands from every browser, so this does not rely on the page. Stop (everyone), Resume, Auto task / Manual hold (operator) and episode recording stay: they supervise the task, they do not command joints.
- Supersedes: "The Control page mirrors the sim while live; edits become joint targets" (the edit-to-target part).
- Rests on: STACK.md §4.1, §7.4.

## 2026-10-30 · Live control only in Manual hold, never while a task runs
- Decided by: the designer (safety)
- Why: the operator can control the robot in live view again, but only after pressing Manual hold; while the task runs (Auto task), after a Stop, and for viewers, joints are locked: cards disabled and following the sim, no wheel or pad, poses and undo/redo off; selecting a part still shows its joint ("Locked"). In Manual hold the operator gets the wheel on the selected part, the XY pad with "All joints follow", editable cards, poses and undo/redo. The tool bar and power budget stay hidden while live, so Move joint drag is not available live (the pad's "All joints follow" covers it). The relay and the sim both refuse joint targets outside Manual hold.
- Supersedes: "Live view is read-only: no joint control from the browser".
- Rests on: STACK.md §4.1, §7.4.

## 2026-10-30 · Live dock under the 3D view: stat tiles and four analysis cards
- Decided by: the designer (layout from the Unit Control reference: tiles and cards along the bottom of the viewer), Claude (data sources)
- Why: while live the space of the tool bar and power budget shows Power, Signal, Speed and Latency (same tiles as the Simulation tab) and four cards: Torque load analysis (share of each motor's torque limit from the model), Joint health (modelled motor temperature, service line at 80 °C), Cycle time (wall time per task cycle against the nominal period; interrupted cycles skipped) and Daily output (task cycles per day, last 7 days, stored by the relay). Every number comes from the sim or the relay; temperature is labelled modelled, models without torque limits say so.
- Rejected: the reference's CoG/payload unit cards (one robot per page) and its decorative charts.
- Rests on: STACK.md §7.4.

## 2026-10-30 · Live dock: latency joins Signal, Sim CPU tile, Joint health as a line
- Decided by: the designer (Signal + latency in one tile, CPU in the freed tile, Joint health as a line with a "Need service" line like the reference), Claude (data and fixed-height text)
- Why: the Signal tile reads "Good · 12 ms" (quality and RTT) with Hz, jitter and age in its caption; the fourth tile shows the sim's CPU (100% = one core). Joint health plots the hottest modelled motor over the last 2 minutes against the 80 °C service line. Card and tile texts never wrap, so a "needs service" state no longer grows the dock and shifts the page.
- Applies to the Simulation tab's tiles too (same component).

## 2026-10-30 · The live dock floats over the 3D view
- Decided by: the designer
- Why: the stat tiles and analysis cards overlay the bottom of the stage instead of taking their own row, so the 3D view keeps its full height. Only the cards take clicks; the model can still be orbited between and above them. Cards get a subtle border because the stage and tiles share a layer colour. From the lg breakpoint tiles and cards are four across (two rows, ≈ 275 px), covering about half the view at 1280×720 and a third at 1440×900; between lg and xlg cards hide their subtitle and stack the headline under the title. Below lg the page scrolls and the dock sits under the view.

## 2026-10-30 · Analysis cards can be hidden; the viewer keeps the robot above the dock
- Decided by: the designer
- Why: a chevron tab on the live dock's top-right edge hides or shows the analysis cards row (the four tiles stay). Whenever the floating dock changes height, and once when the live pose first arrives, the 3D view re-frames: it keeps the viewing direction, re-centres on the robot's current pose and zooms out so the whole robot fits in the part of the view the dock does not cover. Orbiting and zooming by hand still work; the next open/close re-frames.

## 2026-10-30 · Live view has two states: Live view and Stop; going live starts nothing
- Decided by: the designer
- Why: Live view goes straight to live; Stop halts the robot (E-stop, any role, one click) and leaves live view in the same click. There is no Resume state: when the operator goes live again and finds the robot stopped, it is put in Manual hold (holds its pose). A new sim session also starts in Manual hold, so going live never plays the task by itself; the operator starts it with Auto task in the Simulation tab. The Simulation tab's separate Stop button is gone (the header Stop is always visible).
- Supersedes: "Live view: Stop is in the header for every role, one click, no confirmation; Resume needs the operator" (Resume and the separate End live control).

## 2026-10-30 · Right panel shows the robot's cameras while live
- Decided by: the designer (cameras replace the three tiles; enlarge and draggable/resizable picture in picture), Claude (Carbon mapping)
- Why: while live the Battery/Latency/CPU tiles under Health checks give way to one card per camera the sim publishes for the model. Each card has Picture in picture and Enlarge in its top-right corner. Enlarge opens a modal; picture in picture floats the camera over the page, dragged by its title bar and resized from its bottom-right corner, several at once. When live view is off the tiles come back.
- Rejected: the browser's native picture-in-picture (one window, outside the page, no Safari drag/resize control).

## 2026-10-31 · The Control page's left panel lists the robot's policies; joint cards and poses are gone
- Decided by: the designer
- Why: the demo plays policies. The left panel lists the policies the sim offers for the robot (every robot: Joint sweep; Unitree Go1 and G1 also a learned Joystick walk), each with Play, or Pause and a green "Playing" tag when it plays; only the operator can press them, viewers see which one plays. Joints are reached by clicking a part in the 3D view and moved with the wheel or the pad (arrow keys 1°, Shift 10°). Typed joint entry, the joint cards with search, the Zero/keyframe poses and the Simulation tab's "Auto task" button are dropped; Manual hold stays as Pause and in the Simulation tab. The mode tag reads "Playing" while a policy plays.
- Supersedes: the joint-card and pose parts of "Joints move singly (Control joint: wheel, pad, joint cards) or as a chain" (2026-10-29) and of "Live control only in Manual hold, never while a task runs" (2026-10-30); "Auto task" in "Live view has two states" (2026-10-30).

## 2026-11-01 · The visionOS app and the Control page it opens share the operator lock
- Decided by: the designer
- Why: the Vision Pro app and Safari beside it are one operator. The app's Open Control page button opens Safari with a pairing token (`?pair=`); both devices send it when they go live and both are granted operator, so joints dragged in the volume show up in the browser (twin and pad) and policies played in the browser play in the volume. Anyone else still views. The lock is released when the last paired device closes.
- Rejected: one surface at a time (the browser would be view-only next to the app); the app taking over the lock while connected.
- Refines: "One operator per robot; everyone else views until control is free" (2026-10-30).

## 2026-11-02 · The visionOS volume keeps a walking robot at its centre
- Decided by: Claude
- Why: the volume is 1.5 m wide and clips anything outside it, while a walk covers metres. The twin's base therefore stays at the volume's centre, following the sim's height and heading only, so the legs walk in place like a tracking camera. The browser twin still shows the real base position.

## 2026-11-03 · Email-and-password accounts gate /app
- Decided by: the designer
- Why: the live demo starts billed sim containers, so the console needs accounts. Sign-up asks for name, email and password (8+ characters); an emailed activation link (1 hour) must be opened before the first sign-in and signs the user in. Forgot password sends a reset link (1 hour). Any `/app` link lands on sign-in when signed out and returns to the requested page afterwards. Sign-up and reset never reveal whether an address has an account. In production the live relay (WebSocket and camera routes) also requires the session; locally it stays open for the visionOS app and the protocol tests.
- Rejected: sign-in with third-party accounts; a relay left open in production (anyone could start sim containers); requiring the session locally (breaks the visionOS app until it can sign in).

## 2026-11-03 · Auth pages are one centred Carbon form column
- Decided by: Claude
- Why: sign-in, create account, reset and set-new-password share one 25rem column on the page background: brand, heading, a one-line lead, Carbon text and password inputs, one full-width primary button, and a text link for the alternate path. Status (verified, password updated, invalid link, verify first) appears as an inline notification above the form. The header avatar shows the signed-in user's name and opens a panel with name, email and Sign out.

## 2026-11-03 · The assistant lives in a right-side panel on every page
- Decided by: the designer (assistant on every page, signed-in users only, Claude Haiku 5.5 through AI Gateway), Claude (panel layout and Carbon mapping)
- Why: one assistant drives the whole product: it opens robots, filters the fleet, moves joints, changes the view, goes live, plays and pauses policies, stops the robot and explains what it sees. The panel docks on the right as an overlay (no layout shift) and keeps its conversation across pages and when closed. While the open robot is live, the panel header shows a red one-click Stop (the panel covers the page header's Stop; it calls the live client directly, never the model). On `/app` pages the UI Shell header's Assistant action opens it under the header; elsewhere a fixed "Ask NoahOS" button in the bottom-right corner does. One column: header (Assistant, New chat, Close), a greeting with three example tabs (Fleet, Control, Simulation) of runnable prompts, the conversation, and a composer with "The assistant can move robots. Stop halts them." It is built from plain elements with Carbon tokens and IBM Plex so it looks the same on pages without Carbon CSS. Signed-out visitors see "Sign in to use the assistant." with a Sign in button; the chat API refuses requests without a session. It answers only on the live site; locally the panel says so.
- Rejected: anonymous use (anyone could run the model and start sim containers); an Anthropic key as a Worker secret (the gateway's stored key is used through the Worker's AI binding). Each user may send 20 messages a minute (tool steps within a reply have a separate, higher cap).
- Refines: "Carbon styles load only on /app; IBM Plex comes from IBM's CDN" and "DESIGN.md governs the app only" (2026-10-28): the panel brings Carbon tokens and IBM Plex to every page for itself only, with no Carbon reset, so other pages keep their own styles.

## 2026-11-03 · Assistant replies show their work
- Decided by: the designer (show the thought process), Claude (layout)
- Why: an assistant that moves robots must show what it did. Each reply starts with a collapsed "Thinking" row (the model's summarized thinking), then each tool call as a step with a spinner, a green check or a red error and an expandable input/result, then a short plain-text answer. The same tools are published through WebMCP so external agents can drive the product the same way.

