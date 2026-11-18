import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionState } from '../../core/meeting/session';
import { PROVIDER_NAMES, type Suggestions } from '../../core/shared/types';
import { Icon } from './icons';
import { Banner, CopyButton } from './ui';

export interface LiveActions {
  suggestNow(): void;
  quickType(rough: string): void;
  end(): void;
  copy(text: string): void;
  dismissError(): void;
}

const REPLIES: Array<{ key: keyof Suggestions; label: string }> = [
  { key: 'short', label: 'Short' },
  { key: 'detailed', label: 'Detailed' },
  { key: 'safe', label: 'Safe' },
];

function Writing() {
  return (
    <div className="skeleton">
      <span className="skeleton-line" />
      <span className="skeleton-line" />
      <span className="skeleton-status">Writing…</span>
    </div>
  );
}

export interface LiveViewProps {
  state: SessionState;
  actions: LiveActions;
  /** Listening status shown above everything else. */
  status?: ReactNode;
  /** Compact layout for the floating copilot. */
  compact?: boolean;
}

export function LiveView({ state, actions, status, compact = false }: LiveViewProps) {
  const [rough, setRough] = useState('');
  const [roughError, setRoughError] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const hasReplies = REPLIES.some((r) => state.suggestions[r.key]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ block: 'nearest' });
  }, [state.transcript.length]);

  const submitRough = () => {
    const note = rough.trim();
    if (!note) {
      setRoughError(true);
      return;
    }
    actions.quickType(note);
    setRough('');
  };

  return (
    <div className={compact ? 'live live-compact' : 'live'}>
      {status}
      {state.error && (
        <Banner kind="error" onDismiss={actions.dismissError}>
          {state.error}
        </Banner>
      )}

      <section aria-labelledby="client-said">
        <div className="section-head">
          <h2 className="section-label" id="client-said">
            Client said
          </h2>
        </div>
        <p className="client-said">{state.lastClientText || <span className="muted">Listening…</span>}</p>
        {state.skipped && (
          <p className="muted skipped">
            Then: “{state.skipped}” · No reply needed. Press Alt+S if you want one.
          </p>
        )}
      </section>

      <section aria-labelledby="say-this">
        <div className="section-head">
          <h2 className="section-label" id="say-this">
            Say this
          </h2>
          {state.provider && (hasReplies || state.suggesting) && (
            <span className="section-meta">by {PROVIDER_NAMES[state.provider]}</span>
          )}
        </div>
        <div className="replies">
          {state.prepared && (
            <article className="reply reply-prepared">
              <div className="reply-head">
                <span className="reply-label">Your prepared answer</span>
                <CopyButton text={state.prepared.answer} label="Copy your prepared answer" onCopy={actions.copy} />
              </div>
              <p className="reply-text">{state.prepared.answer}</p>
            </article>
          )}
          {REPLIES.map(({ key, label }) => {
            const text = state.suggestions[key];
            return (
              <article className={`reply reply-${key}`} key={key}>
                <div className="reply-head">
                  <span className="reply-label">{label}</span>
                  {text && <CopyButton text={text} label={`Copy ${label} reply`} onCopy={actions.copy} />}
                </div>
                {text ? (
                  <p className="reply-text">{text}</p>
                ) : state.suggesting ? (
                  <Writing />
                ) : (
                  <p className="reply-text reply-empty">—</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="composer">
        <h2 className="section-label" id="own-answer">
          Your answer in Hindi or English
        </h2>
        <textarea
          rows={2}
          value={rough}
          placeholder="Type your answer in Hindi or rough English"
          aria-labelledby="own-answer"
          aria-describedby="own-answer-help"
          onChange={(e) => {
            setRough(e.target.value);
            setRoughError(false);
          }}
          onKeyDown={(e) => {
            // A Hindi keyboard uses Enter to finish a word; that must not send.
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submitRough();
          }}
        />
        <div className="composer-row">
          {roughError ? (
            <span className="field-error" id="own-answer-help" role="alert">
              Type your answer first, then translate.
            </span>
          ) : (
            <span className="field-help" id="own-answer-help">
              Enter to translate · Shift+Enter for a new line
            </span>
          )}
          <button className="btn" onClick={submitRough}>
            <Icon name="languages" size={16} />
            Translate
          </button>
        </div>
        {state.quickType && (
          <article className="reply reply-quick">
            <div className="reply-head">
              <span className="reply-label">Say this · from “{state.quickType.rough}”</span>
              {state.quickType.result && (
                <CopyButton text={state.quickType.result} label="Copy your answer" onCopy={actions.copy} />
              )}
            </div>
            {state.quickType.result ? (
              <p className="reply-text">{state.quickType.result}</p>
            ) : state.quickType.busy ? (
              <Writing />
            ) : (
              <p className="reply-text reply-empty">—</p>
            )}
          </article>
        )}
      </section>

      <div className="actionbar">
        <button className="btn btn-primary" onClick={actions.suggestNow}>
          Suggest now <kbd>⌘⇧↵</kbd>
        </button>
        <button className="btn" onClick={actions.end}>
          <Icon name="stop" size={16} />
          End meeting
        </button>
      </div>

      <details className="transcript" open>
        <summary>Conversation ({state.lineCount})</summary>
        <div className="transcript-lines">
          {state.lineCount === 0 && (
            <p className="muted">
              Nothing heard yet. When the client speaks, their words appear here a moment after they pause.
            </p>
          )}
          {state.transcript.slice(-40).map((line, i) => (
            <p key={`${line.at}-${i}`} className={line.own ? 'own' : ''}>
              <b>{line.own ? 'Me' : line.speaker}</b> <span>{line.text}</span>
            </p>
          ))}
          <div ref={transcriptEnd} />
        </div>
      </details>
    </div>
  );
}
