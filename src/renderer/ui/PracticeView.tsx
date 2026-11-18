import { useEffect, useState } from 'react';
import type { Client, Meeting } from '../../core/shared/types';
import { formatDate } from './format';
import { EmptyState, PageHead } from './ui';

export interface PracticeViewProps {
  listMeetings(): Promise<Meeting[]>;
  listClients?(): Promise<Client[]>;
  /** Switch to the Meeting tab. */
  onStartMeeting?(): void;
}

interface Group {
  meetingId: string;
  date: number;
  clientName: string;
  phrases: string[];
}

const GROUPS_PER_PAGE = 5;
const key = (phrase: string) => phrase.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Phrases from each meeting, newest first, each phrase shown once. */
export function groupPhrases(meetings: Meeting[], clients: Client[]): Group[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const meeting of [...meetings].sort((a, b) => b.startedAt - a.startedAt)) {
    const phrases = (meeting.practice ?? []).filter((phrase) => {
      const k = key(phrase);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (phrases.length) {
      groups.push({ meetingId: meeting.id, date: meeting.startedAt, clientName: names.get(meeting.clientId) ?? '', phrases });
    }
  }
  return groups;
}

/** Short English sentences from recent meetings to practise out loud. */
export function PracticeView({ listMeetings, listClients, onStartMeeting }: PracticeViewProps) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [shown, setShown] = useState(GROUPS_PER_PAGE);

  useEffect(() => {
    void Promise.all([listMeetings(), listClients?.() ?? []]).then(([meetings, clients]) =>
      setGroups(groupPhrases(meetings, clients)),
    );
  }, [listMeetings, listClients]);

  return (
    <div className="column">
      <PageHead
        title="Phrases to practise"
        description="Short sentences from your recent meetings. Say them out loud a few times before your next call."
      />
      {groups === null ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="frame">
          <EmptyState
            icon="book"
            title="No phrases yet"
            action={
              onStartMeeting && (
                <button className="btn btn-primary" onClick={onStartMeeting}>
                  Start a meeting
                </button>
              )
            }
          >
            After each meeting, a few useful sentences from that call appear here.
          </EmptyState>
        </div>
      ) : (
        <>
          {groups.slice(0, shown).map((group) => (
            <section className="card" key={group.meetingId} aria-label={`Meeting on ${formatDate(group.date)}`}>
              <h2 className="section-label">
                {formatDate(group.date)}
                {group.clientName ? ` · ${group.clientName}` : ''}
              </h2>
              <ul className="practice">
                {group.phrases.map((phrase) => (
                  <li key={phrase}>{phrase}</li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length > shown && (
            <button className="btn btn-block" onClick={() => setShown(shown + GROUPS_PER_PAGE)}>
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
