import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, summarise, type SessionDeps } from '../../core/meeting/session';
import type { Client, Meeting } from '../../core/shared/types';
import { newId } from '../../core/storage/db';
import { Icon } from './icons';
import { formatDate } from './format';
import { Banner, EmptyState, PageHead, onTabKeys, useConfirm, type Confirm } from './ui';

const PAGE_SIZE = 20;

export interface ClientsViewProps {
  deps: SessionDeps;
  confirm?: Confirm;
  /** Switch to the Meeting tab. */
  onStartMeeting?(): void;
}

const plainText = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function ClientsView({ deps, confirm: confirmProp, onStartMeeting }: ClientsViewProps) {
  const fallbackConfirm = useConfirm();
  const confirm = confirmProp ?? fallbackConfirm;
  const nameInput = useRef<HTMLInputElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const { db } = deps;
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState<Client | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'notes' | 'meetings'>('notes');
  const [stats, setStats] = useState<Record<string, { count: number; last: number | null }>>({});

  const reload = useCallback(async () => {
    const all = await db.listClients();
    setClients(all);
    const entries = await Promise.all(
      all.map(async (c) => {
        const list = await db.listMeetings(c.id);
        return [c.id, { count: list.length, last: list[0]?.startedAt ?? null }] as const;
      }),
    );
    setStats(Object.fromEntries(entries));
  }, [db]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const openClient = async (client: Client) => {
    setError(null);
    setTab('notes');
    setOpen(client);
    setMeetings(await db.listMeetings(client.id));
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      setNameError('Enter the client’s name first.');
      nameInput.current?.focus();
      return;
    }
    setNameError(null);
    const client: Client = { id: newId(), name, notes: '', importedNotes: '', meetCodes: [], createdAt: deps.now() };
    await db.saveClient(client);
    setNewName('');
    await reload();
    await openClient(client);
  };

  const edit = (patch: Partial<Client>) => setOpen((c) => (c ? { ...c, ...patch } : c));
  const save = async () => {
    if (!open || !open.name.trim()) return;
    await db.saveClient(open);
    await reload();
  };

  if (!open) {
    const q = plainText(query);
    const matches = q ? clients.filter((c) => plainText(`${c.name} ${c.notes}`).includes(q)) : clients;
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const current = Math.min(page, pages - 1);
    const shown = matches.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
    const from = matches.length ? current * PAGE_SIZE + 1 : 0;
    const to = current * PAGE_SIZE + shown.length;

    return (
      <div className="column">
        <PageHead title="Clients" description="Notes and past meetings for each client. The assistant uses them in its replies." />

        <div className="card row">
          <div className="field grow">
            <label className="field-label" htmlFor="new-client">
              New client name
            </label>
            <input
              id="new-client"
              ref={nameInput}
              type="text"
              value={newName}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'new-client-error' : undefined}
              onChange={(e) => {
                setNewName(e.target.value);
                setNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
            />
            {nameError && (
              <span className="field-error" id="new-client-error">
                {nameError}
              </span>
            )}
          </div>
          <button className="btn btn-primary align-end" onClick={() => void add()}>
            <Icon name="plus" size={16} />
            Add client
          </button>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="client-search">
            Search clients
          </label>
          <div className="search">
            <Icon name="search" size={16} />
            <input
              id="client-search"
              type="search"
              value={query}
              placeholder="Name or notes"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        <div className="frame">
          {shown.length === 0 ? (
            clients.length ? (
              <EmptyState
                icon="search"
                title="No clients match"
                action={
                  <button className="btn" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                }
              >
                Nothing matches “{query}”.
              </EmptyState>
            ) : (
              <EmptyState
                icon="users"
                title="No clients yet"
                action={
                  <button className="btn btn-primary" onClick={() => nameInput.current?.focus()}>
                    Add your first client
                  </button>
                }
              >
                Each client keeps notes and meeting history, so replies fit the real project.
              </EmptyState>
            )
          ) : (
            <ul className="frame-list">
              {shown.map((c) => {
                const info = stats[c.id];
                return (
                  <li key={c.id}>
                    <button className="list-row" onClick={() => void openClient(c)}>
                      <span className="list-row-main">
                        <span className="list-row-title">{c.name}</span>
                        <span className="list-row-meta">
                          {info?.count
                            ? `${info.count} meeting${info.count === 1 ? '' : 's'} · last ${formatDate(info.last!)}`
                            : 'No meetings yet'}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="frame-foot">
            <span>
              {pages > 1 ? `${from}–${to} of ${matches.length}` : `${matches.length} client${matches.length === 1 ? '' : 's'}`}
            </span>
            {pages > 1 && (
              <span className="row">
                <button className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Previous
                </button>
                <button className="btn" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Next
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const last = meetings[0];

  return (
    <div className="column">
      <button className="btn-link crumb" onClick={() => setOpen(null)}>
        <Icon name="chevronLeft" size={16} />
        Clients
      </button>
      <PageHead
        title={open.name || 'Untitled client'}
        description={
          meetings.length
            ? `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} · last ${formatDate(last!.startedAt)}`
            : 'No meetings yet'
        }
        actions={
          <button
            className="btn btn-icon"
            aria-label="Delete client"
            data-tip="Delete client"
            onClick={async () => {
              if (!(await confirm(`${open.name} and all its notes and meetings will be deleted. This cannot be undone.`, 'Delete client'))) return;
              void db.deleteClient(open.id).then(async () => {
                setOpen(null);
                await reload();
              });
            }}
          >
            <Icon name="trash" size={18} />
          </button>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      <div className="subtabs" role="tablist" aria-label="Client sections" onKeyDown={onTabKeys}>
        <button
          role="tab"
          id="tab-notes"
          aria-controls="panel-notes"
          className="subtab"
          aria-selected={tab === 'notes'}
          tabIndex={tab === 'notes' ? 0 : -1}
          onClick={() => setTab('notes')}
        >
          Notes
        </button>
        <button
          role="tab"
          id="tab-meetings"
          aria-controls="panel-meetings"
          className="subtab"
          aria-selected={tab === 'meetings'}
          tabIndex={tab === 'meetings' ? 0 : -1}
          onClick={() => setTab('meetings')}
        >
          Meetings ({meetings.length})
        </button>
      </div>

      {tab === 'notes' ? (
        <div className="stack" role="tabpanel" id="panel-notes" aria-labelledby="tab-notes">
          <div className="field">
            <label className="field-label" htmlFor="client-name">
              Client name
            </label>
            <input id="client-name" type="text" value={open.name} onChange={(e) => edit({ name: e.target.value })} onBlur={() => void save()} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="client-notes">
              Notes about this client
            </label>
            <textarea
              id="client-notes"
              value={open.notes}
              placeholder="The project, the people, what they care about, agreed prices and dates."
              onChange={(e) => edit({ notes: e.target.value })}
              onBlur={() => void save()}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="client-imported">
              Past meeting notes (paste Gemini notes here)
            </label>
            <textarea
              id="client-imported"
              value={open.importedNotes}
              placeholder="Paste notes from earlier meetings, oldest first. Add new ones at the bottom."
              onChange={(e) => edit({ importedNotes: e.target.value })}
              onBlur={() => void save()}
            />
          </div>
        </div>
      ) : (
        <div className="stack" role="tabpanel" id="panel-meetings" aria-labelledby="tab-meetings">
          {meetings.length === 0 && (
            <div className="frame">
              <EmptyState
                icon="mic"
                title="No meetings yet"
                action={
                  onStartMeeting && (
                    <button className="btn btn-primary" onClick={onStartMeeting}>
                      Start a meeting
                    </button>
                  )
                }
              >
                Meetings you run with this client appear here with their summary.
              </EmptyState>
            </div>
          )}
          {meetings.map((m) => (
            <article className="card" key={m.id}>
              <div className="meeting-head">
                <h2 className="card-title">{formatDate(m.startedAt)}</h2>
                {m.endedAt === null && <span className="section-meta">Not finished</span>}
              </div>
              {m.summary ? (
                <pre className="summary">{m.summary}</pre>
              ) : m.transcript.length > 0 ? (
                <button
                  className="btn"
                  disabled={busy === m.id}
                  onClick={() => {
                    setBusy(m.id);
                    setError(null);
                    summarise(deps, m)
                      .then(async () => setMeetings(await db.listMeetings(open.id)))
                      .catch((e) => setError(errorMessage(e) || 'Could not write the summary.'))
                      .finally(() => setBusy(null));
                  }}
                >
                  {busy === m.id ? 'Writing…' : 'Summarise'}
                </button>
              ) : (
                <p className="muted">Nothing was said.</p>
              )}
              {m.practice && m.practice.length > 0 && (
                <details>
                  <summary>Phrases to practise ({m.practice.length})</summary>
                  <ul className="practice">
                    {m.practice.map((phrase, i) => (
                      <li key={i}>{phrase}</li>
                    ))}
                  </ul>
                </details>
              )}
              {m.transcript.length > 0 && (
                <details>
                  <summary>Full conversation ({m.transcript.length})</summary>
                  <div className="transcript-lines">
                    {m.transcript.map((line, i) => (
                      <p key={i} className={line.own ? 'own' : ''}>
                        <b>{line.own ? 'Me' : line.speaker}</b> {line.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
