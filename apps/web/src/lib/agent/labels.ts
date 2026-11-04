/** One-line label for a tool step in the assistant panel. `input` is the model's (untrusted) arguments. */
export function stepLabel(name: string, input: unknown): string {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  switch (name) {
    case 'set_joints': {
      const joints = Array.isArray(args.joints) ? (args.joints as Record<string, unknown>[]) : []
      const parts = joints
        .filter((j) => j && typeof j.name === 'string' && typeof j.value === 'number')
        .map((j) => {
          const unit = j.unit === 'rad' ? ' rad' : j.unit === 'm' ? ' m' : '°'
          return `${j.name as string} ${j.value as number}${unit}`
        })
      return parts.length ? `Set joints · ${parts.join(', ')}` : 'Set joints'
    }
    case 'navigate': {
      const to = str('to')
      if (to === 'robot') return `Open ${str('robotId') ?? 'robot'}`
      return 'Open fleet'
    }
    case 'live_view': {
      const action = str('action')
      return action ? `Live view · ${action.replace(/_/g, ' ')}` : 'Live view'
    }
    case 'run_policy':
      return str('action') === 'pause' ? 'Pause policy' : `Play ${str('policy') ?? 'policy'}`
    default: {
      const text = name.replace(/_/g, ' ')
      return text.charAt(0).toUpperCase() + text.slice(1)
    }
  }
}
