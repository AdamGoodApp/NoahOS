import { useEffect, useRef } from 'react'

import type { CameraFeed } from '@/lib/live/cameras'

/** One camera's MediaStream in a muted inline <video>; several elements can show the same stream at once. */
export function CameraVideo({ feed, label, className }: { feed: CameraFeed; label: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (v && v.srcObject !== feed.stream) v.srcObject = feed.stream
  }, [feed.stream])
  return <video ref={ref} className={className} autoPlay muted playsInline aria-label={label} />
}
