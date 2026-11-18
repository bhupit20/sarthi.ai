import { useEffect, useState } from 'react';
import type { MeetingSession, SessionState } from '../../core/meeting/session';

/** The session's current state, re-rendering on every change. Null when there is no session. */
export function useSessionState(session: MeetingSession | null): SessionState | null {
  const [state, setState] = useState<SessionState | null>(session?.getState() ?? null);
  useEffect(() => {
    if (!session) {
      setState(null);
      return;
    }
    setState(session.getState());
    return session.subscribe(setState);
  }, [session]);
  return state;
}
