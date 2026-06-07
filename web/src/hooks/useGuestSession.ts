import { useState, useEffect } from 'react'

export const GUEST_KEY = 'gpt-image-guest-id'

function generateId(): string {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return 'guest-' + id.slice(0, 8)
}

export interface GuestSession {
  guestId: string
  isNew: boolean
}

export function useGuestSession(): GuestSession | null {
  const [session, setSession] = useState<GuestSession | null>(null)

  useEffect(() => {
    let guestId = localStorage.getItem(GUEST_KEY)
    let isNew = false
    if (!guestId) {
      guestId = generateId()
      localStorage.setItem(GUEST_KEY, guestId)
      isNew = true
    }
    setSession({ guestId, isNew })

    // Register with backend
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId, isNew }),
    }).catch(() => {})
  }, [])

  return session
}
