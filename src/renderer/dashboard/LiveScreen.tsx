import { sarthi } from '../lib/bridge';
import type { LiveSnapshot, SessionController } from '../lib/controller';
import { formatDate } from '../ui/format';
import { Icon } from '../ui/icons';
import { ListeningStatus } from '../ui/ListeningStatus';
import { LiveView } from '../ui/LiveView';
import { Banner, EmptyState, PageHead } from '../ui/ui';
import type { View } from './App';

export function LiveScreen({
  controller,
  live,
  onNavigate,
}: {
  controller: SessionController;
  live: LiveSnapshot;
  onNavigate(view: View): void;
}) {
  const state = live.session;

  if (!state) {
    return (
      <div className="column">
        <PageHead title="Live session" />
        <div className="card">
          <EmptyState
            icon="radio"
            title="No session running"
            action={
              <button className="btn btn-primary" onClick={() => onNavigate('home')}>
                Start a session
              </button>
            }
          >
            Start a session from Home before your call. Replies then appear here and in the floating copilot.
          </EmptyState>
        </div>
      </div>
    );
  }

  if (state.phase === 'ended') {
    return (
      <div className="column">
        <PageHead
          title="Session saved"
          description={state.meeting ? `${live.clientName} · ${state.lineCount} lines · ${formatDate(state.meeting.startedAt)}` : undefined}
        />
        {state.error && <Banner kind="error">{state.error}</Banner>}
        <section className="card">
          <h2 className="section-label">Summary</h2>
          {state.meeting?.summary ? (
            <pre className="summary">{state.meeting.summary}</pre>
          ) : (
            !state.error && <p className="muted">Nothing was said, so there is no summary.</p>
          )}
        </section>
        {state.meeting?.practice && state.meeting.practice.length > 0 && (
          <section className="card">
            <h2 className="section-label">Phrases to practise</h2>
            <ul className="practice">
              {state.meeting.practice.map((phrase, i) => (
                <li key={i}>{phrase}</li>
              ))}
            </ul>
          </section>
        )}
        <button
          className="btn btn-primary align-start"
          onClick={() => {
            controller.clear();
            onNavigate('home');
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="column">
      <div className="live-head">
        <PageHead title={`Live with ${live.clientName || 'your client'}`} />
        <button className="btn" onClick={() => sarthi().copilot.show()}>
          <Icon name="externalLink" size={16} />
          Show copilot
        </button>
      </div>
      {state.phase === 'ending' && <Banner kind="info">Saving the session and writing the summary…</Banner>}
      <LiveView
        state={state}
        status={<ListeningStatus engine={live.engine} />}
        actions={{
          suggestNow: () => void controller.suggestNow(),
          quickType: (text) => controller.quickType(text),
          end: () => void controller.end(),
          copy: (text) => void navigator.clipboard?.writeText(text),
          dismissError: () => controller.dismissError(),
        }}
      />
    </div>
  );
}
