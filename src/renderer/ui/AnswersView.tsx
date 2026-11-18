import { useEffect, useRef, useState } from 'react';
import { keywordList, loadPrepared, savePrepared, type PreparedAnswer } from '../../core/meeting/prepared';
import { errorMessage } from '../../core/meeting/session';
import { newId } from '../../core/storage/db';
import type { KeyValueStore } from '../../core/storage/kv';
import { Icon } from './icons';
import { Banner, EmptyState, PageHead, useConfirm, type Confirm } from './ui';

export interface AnswersViewProps {
  kv: KeyValueStore;
  /** Turn a Hindi or rough answer into polished English. */
  translate(text: string): Promise<string>;
  describeError?(error: unknown): string;
  confirm?: Confirm;
}

const PAGE_SIZE = 20;
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

interface Draft {
  keywords: string;
  answer: string;
  /** Not saved yet: Cancel removes it. */
  isNew: boolean;
  tried?: boolean;
}

/**
 * Unsaved edits, kept while the panel is open so switching tabs does not
 * lose them.
 */
const openDrafts = new Map<string, Draft>();

/** Throw away unsaved answers (used when all data is deleted, and between tests). */
export function discardAnswerDrafts(): void {
  openDrafts.clear();
}

/** Answers the owner writes once for the questions clients always ask. */
export function AnswersView({ kv, translate, describeError = errorMessage, confirm: confirmProp }: AnswersViewProps) {
  const fallbackConfirm = useConfirm();
  const confirm = confirmProp ?? fallbackConfirm;
  const [list, setList] = useState<PreparedAnswer[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(openDrafts));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    void loadPrepared(kv).then(setList);
    return () => clearTimeout(savedTimer.current);
  }, [kv]);

  if (!list) return <p className="muted">Loading…</p>;

  const setDraft = (id: string, draft: Draft | null) => {
    if (draft) openDrafts.set(id, draft);
    else openDrafts.delete(id);
    setDrafts(Object.fromEntries(openDrafts));
  };

  const add = () => {
    setQuery('');
    setPage(0);
    setSavedId(null);
    setDraft(newId(), { keywords: '', answer: '', isNew: true });
  };

  const edit = (entry: PreparedAnswer) => {
    setSavedId(null);
    setDraft(entry.id, { keywords: entry.keywords, answer: entry.answer, isNew: false });
  };

  const save = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    if (!keywordList(draft.keywords).length || !draft.answer.trim()) {
      setDraft(id, { ...draft, tried: true });
      return;
    }
    const entry: PreparedAnswer = { id, keywords: draft.keywords.trim(), answer: draft.answer.trim() };
    const current = await loadPrepared(kv);
    const next = current.some((p) => p.id === id) ? current.map((p) => (p.id === id ? entry : p)) : [entry, ...current];
    await savePrepared(kv, next);
    setList(next);
    setDraft(id, null);
    setSavedId(id);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedId(null), 4000);
  };

  const improve = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    if (!draft.answer.trim()) {
      setDraft(id, { ...draft, tried: true });
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const english = (await translate(draft.answer)).trim();
      const latest = openDrafts.get(id);
      if (english && latest) setDraft(id, { ...latest, answer: english });
    } catch (e) {
      setError(describeError(e) || 'Could not translate the answer.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: PreparedAnswer) => {
    const name = entry.keywords.trim() || 'this answer';
    if (!(await confirm(`The prepared answer for “${name}” will be deleted. This cannot be undone.`, 'Delete answer'))) return;
    const next = (await loadPrepared(kv)).filter((p) => p.id !== entry.id);
    await savePrepared(kv, next);
    setList(next);
  };

  // New, unsaved answers first, then saved ones.
  const newIds = Object.entries(drafts)
    .filter(([, d]) => d.isNew)
    .map(([id]) => id);
  const q = plain(query);
  const saved = q ? list.filter((p) => plain(`${p.keywords} ${p.answer}`).includes(q)) : list;
  const pages = Math.max(1, Math.ceil(saved.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = saved.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const rows: Array<{ id: string; entry?: PreparedAnswer }> = [
    ...newIds.map((id) => ({ id })),
    ...shown.map((entry) => ({ id: entry.id, entry })),
  ];

  return (
    <div className="column">
      <PageHead
        title="Prepared answers"
        description="Write your best answer once for what clients always ask. When the client says one of your words, your answer appears at once. Changes apply from the next meeting."
        actions={
          <button className="btn btn-primary" onClick={add}>
            <Icon name="plus" size={16} />
            Add an answer
          </button>
        }
      />
      {error && (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="field">
        <label className="field-label" htmlFor="answer-search">
          Search answers
        </label>
        <div className="search">
          <Icon name="search" size={16} />
          <input
            id="answer-search"
            type="search"
            value={query}
            placeholder="Words or answer text"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>

      <div className="frame">
        {rows.length === 0 ? (
          list.length ? (
            <EmptyState
              icon="search"
              title="No answers match"
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
              icon="message"
              title="No prepared answers yet"
              action={
                <button className="btn btn-primary" onClick={add}>
                  Write your first answer
                </button>
              }
            >
              Your own answer appears the moment a client asks. Good ones to start with: price, timeline, revisions and
              payment.
            </EmptyState>
          )
        ) : (
          <ul className="frame-list">
            {rows.map(({ id, entry }) => {
              const draft = drafts[id];
              if (draft) {
                const missingWords = draft.tried && !keywordList(draft.keywords).length;
                const missingAnswer = draft.tried && !draft.answer.trim();
                return (
                  <li className="answer" key={id}>
                    <div className="field">
                      <label className="field-label" htmlFor={`kw-${id}`}>
                        When the client says
                      </label>
                      <input
                        id={`kw-${id}`}
                        type="text"
                        value={draft.keywords}
                        placeholder="price, cost, how much"
                        aria-invalid={missingWords || undefined}
                        aria-describedby={`kw-help-${id}`}
                        onChange={(e) => setDraft(id, { ...draft, keywords: e.target.value })}
                      />
                      {missingWords ? (
                        <span className="field-error" id={`kw-help-${id}`}>
                          Add the words clients use.
                        </span>
                      ) : (
                        <span className="field-help" id={`kw-help-${id}`}>
                          Short words or phrases, separated by commas, for example: price, cost, how much.
                        </span>
                      )}
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor={`ans-${id}`}>
                        My answer
                      </label>
                      <textarea
                        id={`ans-${id}`}
                        value={draft.answer}
                        placeholder="Write it in English, or in Hindi and press Translate and improve."
                        aria-invalid={missingAnswer || undefined}
                        aria-describedby={missingAnswer ? `ans-error-${id}` : undefined}
                        onChange={(e) => setDraft(id, { ...draft, answer: e.target.value })}
                      />
                      {missingAnswer && (
                        <span className="field-error" id={`ans-error-${id}`}>
                          Write your answer.
                        </span>
                      )}
                    </div>
                    <div className="row">
                      <button className="btn" disabled={busy === id} onClick={() => void improve(id)}>
                        <Icon name="languages" size={16} />
                        {busy === id ? 'Translating…' : 'Translate and improve'}
                      </button>
                    </div>
                    <div className="row answer-actions">
                      <button className="btn" onClick={() => setDraft(id, null)}>
                        Cancel
                      </button>
                      <button className="btn btn-primary" onClick={() => void save(id)}>
                        <Icon name="check" size={16} />
                        Save answer
                      </button>
                    </div>
                  </li>
                );
              }
              if (!entry) return null;
              return (
                <li className="answer" key={id}>
                  <div className="answer-view">
                    <span className="field-help">When the client says</span>
                    <p className="answer-keywords">{keywordList(entry.keywords).join(' · ')}</p>
                  </div>
                  <p className="answer-text">{entry.answer}</p>
                  <div className="row">
                    {savedId === id && (
                      <span className="status-text status-ok row" role="status">
                        <Icon name="check" size={14} />
                        Saved
                      </span>
                    )}
                    <span className="grow" />
                    <button className="btn" onClick={() => edit(entry)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-icon"
                      aria-label="Delete this answer"
                      data-tip="Delete this answer"
                      onClick={() => void remove(entry)}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="frame-foot">
          <span>
            {saved.length} answer{saved.length === 1 ? '' : 's'}
            {pages > 1 && ` · page ${current + 1} of ${pages}`}
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

      {list.length > 0 && (
        <button className="btn align-start" onClick={add}>
          <Icon name="plus" size={16} />
          Add another answer
        </button>
      )}
    </div>
  );
}
