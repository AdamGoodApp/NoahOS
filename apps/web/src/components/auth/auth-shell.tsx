import type { ReactNode } from 'react'

/** Page frame for every /auth page: brand, heading, optional lead, content and a footer line. */
export function AuthShell({ title, lead, children, footer }: { title: string; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <a href="/" className="fleet-brand auth-brand">
          NoahOS
        </a>
        <h1 className="auth-title">{title}</h1>
        {lead && <p className="auth-lead">{lead}</p>}
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </div>
    </main>
  )
}
