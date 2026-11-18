import { useEffect, useState } from 'react';
import { loadPrepared } from '../../core/meeting/prepared';
import { errorMessage, summarise } from '../../core/meeting/session';
import type { Client, Meeting } from '../../core/shared/types';
import { newId } from '../../core/storage/db';
import { loadProfile } from '../../core/storage/settings';
import type { PermissionStatus } from '../../shared/api';
import { sarthi } from '../lib/bridge';
import type { LiveSnapshot, SessionController } from '../lib/controller';
import { formatDate } from '../ui/format';
import { Icon, type IconName } from '../ui/icons';
import { Banner, EmptyState, PageHead } from '../ui/ui';
import type { View } from './App';
import type { Services } from './services';

const NEW_CLIENT = '__new__';
const WEEK = 7 * 24 * 3600 * 1000;

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

interface Readiness {
  hasKey: boolean;
  permissions: PermissionStatus;
  hasProfile: boolean;
  answers: number;
}

export function HomeView({
  services,
  controller,
  live,
  onNavigate,
}: {
  services: Services;
  controller: SessionController;
  live: LiveSnapshot;
  onNavigate(view: View): void;
}) {
  const { db } = services.deps;
  const [clients, setClients] = useState<Client[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLive = live.session?.phase === 'live' || live.session?.phase === 'ending';

  const refresh = async () => {
    const [all, data, keys, permissions, profile, answers] = await Promise.all([
      db.listClients(),
      db.exportAll(),
      sarthi().keys.status(),
      sarthi().permissions.status(),
      loadProfile(services.kv),
      loadPrepared(services.kv),
    ]);
    setClients(all);
    setMeetings(data.meetings.sort((a, b) => b.startedAt - a.startedAt));
    setReady({ hasKey: Object.values(keys).some(Boolean), permissions, hasProfile: profile.text.trim().length > 0, answers: answers.length });
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unfinished = meetings.find((m) => m.endedAt === null);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const now = Date.now();
  const thisWeek = meetings.filter((m) => now - m.startedAt < WEEK).length;
  const phrases = meetings.reduce((n, m) => n + (m.practice?.length ?? 0), 0);

  const start = async () => {
    setError(null);
    if (selected === '' || (selected === NEW_CLIENT && !newName.trim())) {
      setError(selected === NEW_CLIENT ? 'Enter the new client’s name first.' : 'Choose who the call is with first.');
      return;
    }
    setBusy(true);
    try {
      let clientId = selected;
      if (selected === NEW_CLIENT) {
        const client: Client = { id: newId(), name: newName.trim(), notes: '', importedNotes: '', meetCodes: [], createdAt: Date.now() };
        await db.saveClient(client);
        clientId = client.id;
      }
      onNavigate('live');
      await controller.start(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  };

  const finishUnfinished = async (meeting: Meeting) => {
    setBusy(true);
    try {
      if (meeting.transcript.length) await summarise(services.deps, meeting);
      else await db.saveMeeting({ ...meeting, endedAt: Date.now() });
    } catch (e) {
      await db.saveMeeting({ ...meeting, endedAt: meeting.endedAt ?? Date.now() });
      setError(`The session is saved, but the summary could not be written. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const steps: Array<{ done: boolean; title: string; help: string; action?: { label: string; run(): void } }> = ready
    ? [
        {
          done: ready.hasKey,
          title: 'Add an AI key',
          help: 'Claude, Gemini, OpenAI or NVIDIA. Stored in your Mac’s Keychain.',
          action: { label: 'Add key', run: () => onNavigate('settings') },
        },
        {
          done: ready.permissions.microphone === 'granted',
          title: 'Allow the microphone',
          help: 'So your own words appear in the conversation.',
          action: {
            label: 'Allow',
            run: () => void sarthi().permissions.requestMicrophone().then(refresh),
          },
        },
        {
          done: ready.permissions.screen === 'granted',
          title: 'Allow call audio',
          help: 'Screen & System Audio Recording lets SARTHI hear the client in any app.',
          action: { label: 'Open settings', run: () => sarthi().permissions.openSettings('screen') },
        },
        {
          done: live.engine.model.state === 'ready',
          title: 'Download the speech model',
          help: 'About 80 MB, once. Speech is turned into text on this Mac.',
          action:
            live.engine.model.state === 'loading'
              ? undefined
              : { label: 'Download', run: () => void controller.transcriber.load().catch(() => {}) },
        },
        {
          done: ready.hasProfile,
          title: 'Tell SARTHI about you',
          help: 'Your work, prices and how you like to work.',
          action: { label: 'Write', run: () => onNavigate('settings') },
        },
        {
          done: ready.answers > 0,
          title: 'Prepare a few answers',
          help: 'Price, timeline, revisions: your words, shown instantly.',
          action: { label: 'Add', run: () => onNavigate('answers') },
        },
      ]
    : [];
  const doneCount = steps.filter((s) => s.done).length;

  const tiles: Array<{ icon: IconName; label: string; value: number; to: View }> = [
    { icon: 'radio', label: 'Sessions this week', value: thisWeek, to: 'clients' },
    { icon: 'message', label: 'Prepared answers', value: ready?.answers ?? 0, to: 'answers' },
    { icon: 'book', label: 'Phrases to practise', value: phrases, to: 'practice' },
  ];

  return (
    <div className="column-wide">
      <PageHead
        title={`${greeting(new Date())}`}
        description="Start a session before your call. SARTHI listens and shows what to say, in simple English."
      />

      {unfinished && (
        <Banner kind="warning">
          <span>
            A session with {names.get(unfinished.clientId) ?? 'a client'} on {formatDate(unfinished.startedAt)} did not finish
            saving. Its conversation is safe.
          </span>
          <span className="row">
            <button className="btn" disabled={busy} onClick={() => void finishUnfinished(unfinished)}>
              Finish and summarise
            </button>
            {!isLive && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  onNavigate('live');
                  void controller.resume(unfinished).catch((e) => setError(String(e)));
                }}
              >
                Resume session
              </button>
            )}
          </span>
        </Banner>
      )}

      <div className="home-grid">
        <section className="card hero" aria-labelledby="start-title">
          <h2 className="card-title" id="start-title">
            {isLive ? `Session with ${live.clientName || 'your client'}` : 'Start a session'}
          </h2>
          {isLive ? (
            <>
              <p className="muted">SARTHI is listening. Replies appear in the copilot and on the Live session page.</p>
              <button className="btn btn-primary btn-large" onClick={() => onNavigate('live')}>
                <Icon name="radio" size={18} />
                Open live session
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label className="field-label" htmlFor="client-select">
                  Who is the call with?
                </label>
                <select
                  id="client-select"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setError(null);
                  }}
                >
                  <option value="">Choose a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW_CLIENT}>+ New client</option>
                </select>
              </div>
              {selected === NEW_CLIENT && (
                <div className="field">
                  <label className="field-label" htmlFor="new-client-name">
                    New client name
                  </label>
                  <input id="new-client-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
              )}
              {error && (
                <span className="field-error" role="alert">
                  {error}
                </span>
              )}
              <button className="btn btn-primary btn-large" disabled={busy} onClick={() => void start()}>
                <Icon name="headphones" size={18} />
                Start listening
              </button>
              <p className="field-help">
                Join your call in Meet, Zoom or Teams, then press Start. <kbd>⌘⇧↵</kbd> asks for replies at any time.
              </p>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="ready-title">
          <div className="section-head">
            <h2 className="card-title" id="ready-title">
              Before your first call
            </h2>
            <span className="section-meta">
              {doneCount} of {steps.length}
            </span>
          </div>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
          </div>
          <ul className="checklist">
            {steps.map((step) => (
              <li key={step.title}>
                <span className={`check-mark${step.done ? ' done' : ''}`} aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
                <span className="check-body">
                  <span className="check-title">
                    {step.title}
                    <span className="visually-hidden">{step.done ? ' (done)' : ' (to do)'}</span>
                  </span>
                  <span className="check-help" style={{ display: 'block' }}>
                    {step.help}
                  </span>
                </span>
                {!step.done && step.action && (
                  <button className="btn" onClick={step.action.run}>
                    {step.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="tiles">
        {tiles.map((tile) => (
          <button key={tile.label} className="card tile" onClick={() => onNavigate(tile.to)}>
            <span className="tile-head">
              <span className="tile-mark">
                <Icon name={tile.icon} size={16} />
              </span>
              {tile.label}
            </span>
            <span className="tile-value">{tile.value}</span>
          </button>
        ))}
      </div>

      <section aria-labelledby="recent-title">
        <div className="section-head">
          <h2 className="card-title" id="recent-title">
            Recent sessions
          </h2>
          <button className="btn-link" onClick={() => onNavigate('clients')}>
            All clients
          </button>
        </div>
        <div className="frame">
          {meetings.length === 0 ? (
            <EmptyState icon="radio" title="No sessions yet">
              Your sessions appear here with a short summary of what was decided.
            </EmptyState>
          ) : (
            <ul className="frame-list">
              {meetings.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <div className="list-row" style={{ cursor: 'default' }}>
                    <span className="list-row-main">
                      <span className="list-row-title">{names.get(m.clientId) ?? 'Client'}</span>
                      <span className="list-row-meta">
                        {formatDate(m.startedAt)} · {m.transcript.length} lines
                        {m.summary ? ` · ${m.summary.split('\n').find((l) => l.startsWith('-'))?.slice(2) ?? ''}` : ''}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
