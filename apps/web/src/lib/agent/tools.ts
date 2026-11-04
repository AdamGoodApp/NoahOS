import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

/**
 * Assistant tool definitions, shared by the server (`chat({ tools })`: the model sees them)
 * and the browser (`client-tools.ts` gives each an implementation that drives the UI).
 */

const STATUSES = ['online', 'charging', 'idle', 'fault', 'offline'] as const
const CATEGORIES = ['Humanoid', 'Mobile manipulator', 'Quadruped', 'Arm'] as const
const SITES = ['Tokyo Lab', 'Nagoya Lab', 'Osaka Lab'] as const

const robotId = z
  .string()
  .optional()
  .meta({ description: "Robot id from list_robots. Defaults to the robot whose Control page is open." })
const robotScoped = { robotId }
const editCount = z.number().int().min(1).max(20).optional().meta({ description: 'How many edits (default 1).' })

export const getPageContextDef = toolDefinition({
  name: 'get_page_context',
  description: 'Which page the user is on (fleet, control, auth) and the open robot id.',
  inputSchema: z.object({}),
})

export const listRobotsDef = toolDefinition({
  name: 'list_robots',
  description:
    'List fleet robots with id, name, category, site, status, battery, operator and activity. Filters are optional; query matches name, site, activity, category or operator.',
  inputSchema: z.object({
    status: z.enum(STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    site: z.enum(SITES).optional(),
    query: z.string().optional().meta({ description: 'Case-insensitive text to look for.' }),
  }),
})

export const getRobotDef = toolDefinition({
  name: 'get_robot',
  description: 'Fleet record of one robot (status, site, battery, operator, activity, last seen). Does not open its page.',
  inputSchema: z.object({ robotId: z.string() }),
})

export const getRobotModelDef = toolDefinition({
  name: 'get_robot_model',
  description:
    "Open the robot's Control page if needed and return its model: every joint with type, range and current value (degrees for hinges, metres for slides), the selected part and live status. Use this before moving joints.",
  inputSchema: z.object(robotScoped),
})

export const navigateDef = toolDefinition({
  name: 'navigate',
  description: "Go to the fleet dashboard or a robot's Control page (robotId required for 'robot').",
  inputSchema: z.object({ to: z.enum(['fleet', 'robot']), robotId: z.string().optional() }),
})

export const filterFleetDef = toolDefinition({
  name: 'filter_fleet',
  description:
    'Set the fleet dashboard filters, search, sort or view (opens the dashboard if needed). clear:true resets all filters first. Returns the counts per status and the visible robots.',
  inputSchema: z.object({
    status: z.enum(['all', ...STATUSES]).optional(),
    sites: z.array(z.string()).optional(),
    categories: z.array(z.enum(CATEGORIES)).optional(),
    operators: z.array(z.string()).optional(),
    batteryMin: z.number().min(0).max(100).optional(),
    batteryMax: z.number().min(0).max(100).optional(),
    query: z.string().optional().meta({ description: 'Search text (name, site, activity, operator).' }),
    sort: z.enum(['status', 'battery', 'name', 'seen']).optional(),
    view: z.enum(['grid', 'list']).optional(),
    clear: z.boolean().optional(),
  }),
})

export const setJointsDef = toolDefinition({
  name: 'set_joints',
  description:
    "Set one or more joints of the robot's 3D twin (and the live robot when live in Manual mode). Hinge joints take degrees (or rad), slide joints metres. Values are clamped to the joint range.",
  inputSchema: z.object({
    robotId,
    joints: z
      .array(
        z.object({
          name: z.string().meta({ description: 'Joint name from get_robot_model.' }),
          value: z.number().meta({ description: 'Target position in `unit`.' }),
          unit: z
            .enum(['deg', 'rad', 'm'])
            .optional()
            .meta({ description: 'Defaults to deg for hinge joints and m for slide joints.' }),
        }),
      )
      .min(1),
  }),
})

export const resetPoseDef = toolDefinition({
  name: 'reset_pose',
  description: 'Return every joint to the rest pose (zero, or the nearest limit).',
  inputSchema: z.object(robotScoped),
})

export const selectPartDef = toolDefinition({
  name: 'select_part',
  description:
    'Highlight a body of the twin, or the body a joint belongs to (give one of body or joint; omit both to clear the selection). Returns the joints of that body.',
  inputSchema: z.object({ robotId, body: z.string().optional(), joint: z.string().optional() }),
})

export const setViewDef = toolDefinition({
  name: 'set_view',
  description: 'Change the 3D view: a camera preset and/or zoom percentage (100 = fit).',
  inputSchema: z.object({
    robotId,
    preset: z.enum(['iso', 'front', 'back', 'left', 'right', 'top']).optional(),
    zoomPercent: z.number().min(25).max(400).optional(),
  }),
})

export const setToolDef = toolDefinition({
  name: 'set_tool',
  description:
    "Pick the twin's pointer tool: camera (orbit), control (click a part, turn its joint), move (drag a part with inverse kinematics). Only when not live.",
  inputSchema: z.object({ robotId, tool: z.enum(['camera', 'control', 'move']) }),
})

export const undoEditDef = toolDefinition({
  name: 'undo_edit',
  description: 'Undo the last joint edits.',
  inputSchema: z.object({ robotId, count: editCount }),
})

export const redoEditDef = toolDefinition({
  name: 'redo_edit',
  description: 'Redo joint edits.',
  inputSchema: z.object({ robotId, count: editCount }),
})

export const liveViewDef = toolDefinition({
  name: 'live_view',
  description:
    "start: connect the Control page to the robot's simulation (telemetry, cameras, policies; takes a few seconds). stop: emergency stop, freezes the robot and leaves Live view. take_control: request the operator role.",
  inputSchema: z.object({ robotId, action: z.enum(['start', 'stop', 'take_control']) }),
})

export const runPolicyDef = toolDefinition({
  name: 'run_policy',
  description:
    'play: run a policy by id or name (from get_robot_model or live_view); pause: Manual hold, the robot keeps its pose and joints become editable. Needs Live view and the operator role.',
  inputSchema: z.object({
    robotId,
    action: z.enum(['play', 'pause']),
    policy: z.string().optional().meta({ description: 'Policy id or name; required for play.' }),
  }),
})

export const recordEpisodeDef = toolDefinition({
  name: 'record_episode',
  description: 'Start or stop recording the live session to an episode.',
  inputSchema: z.object({ robotId, action: z.enum(['start', 'stop']), label: z.string().optional() }),
})

export const openTabDef = toolDefinition({
  name: 'open_tab',
  description: 'Switch the Control page tab.',
  inputSchema: z.object({ robotId, tab: z.enum(['control', 'simulation', 'logs']) }),
})

export const cameraWindowDef = toolDefinition({
  name: 'camera_window',
  description:
    'Enlarge a live camera, pop it out as picture in picture, or close the enlarged/popped-out window. Camera names come from live_view/get_live_status.',
  inputSchema: z.object({
    robotId,
    camera: z.string(),
    action: z.enum(['enlarge', 'picture_in_picture', 'close']),
  }),
})

export const getLiveStatusDef = toolDefinition({
  name: 'get_live_status',
  description: 'Live view state: status, mode, policy, role, telemetry rate, latency, cameras and the last events.',
  inputSchema: z.object(robotScoped),
})

export const TOOL_DEFINITIONS = [
  getPageContextDef,
  listRobotsDef,
  getRobotDef,
  getRobotModelDef,
  navigateDef,
  filterFleetDef,
  setJointsDef,
  resetPoseDef,
  selectPartDef,
  setViewDef,
  setToolDef,
  undoEditDef,
  redoEditDef,
  liveViewDef,
  runPolicyDef,
  recordEpisodeDef,
  openTabDef,
  cameraWindowDef,
  getLiveStatusDef,
]
