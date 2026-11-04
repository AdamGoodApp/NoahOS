export type ExampleTab = { label: string; examples: { prompt: string; hint: string }[] }

/** Runnable example prompts in the assistant's empty state. */
export const EXAMPLE_TABS: ExampleTab[] = [
  {
    label: 'Fleet',
    examples: [
      { prompt: 'Which robots are in a fault state?', hint: 'Lists them with site and activity' },
      { prompt: 'Show quadrupeds at Nagoya Lab', hint: 'Applies the fleet filters' },
      { prompt: 'Summarize the Unitree G1', hint: 'Opens it and reads its joints and status' },
    ],
  },
  {
    label: 'Control',
    examples: [
      { prompt: 'Open the Unitree G1 and bend its left elbow to 45°', hint: 'Moves a joint of the twin' },
      { prompt: 'Look at the robot from the front at 150% zoom', hint: 'Changes the 3D view' },
      { prompt: 'Undo the last joint edit', hint: 'Steps back in the edit history' },
    ],
  },
  {
    label: 'Simulation',
    examples: [
      { prompt: 'Go live on the Unitree Go1 and play Joystick walk', hint: 'Starts the sim and a policy' },
      { prompt: 'Pause the policy and hold the pose', hint: 'Switches to Manual hold' },
      { prompt: 'Stop the robot', hint: 'Emergency stop: freezes the pose' },
    ],
  },
]
