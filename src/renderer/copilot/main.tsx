import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/base.css';
import '../ui/app.css';
import { sarthi } from '../lib/bridge';
import type { LiveSnapshot } from '../lib/controller';
import { Icon } from '../ui/icons';
import { ListeningStatus } from '../ui/ListeningStatus';
import { LiveView } from '../ui/LiveView';
import { EmptyState } from '../ui/ui';

/** The floating window: mirrors the live session and sends actions back. */
function Copilot() {
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  useEffect(() => sarthi().copilot.onState((state) => setLive(state as LiveSnapshot)), []);
  const api = sarthi();
  const state = live?.session;
  const running = state && (state.phase === 'live' || state.phase === 'ending');

  return (
    <div className="copilot">
      <header className="copilot-bar">
        <span className="logo-mark">
          <Icon name="headphones" size={14} />
        </span>
        <span className="copilot-title">{running ? live!.clientName || 'Live session' : 'SARTHI.AI'}</span>
        {running && (
          <span className="status status-live" role="status">
            <span className="status-dot" aria-hidden="true" />
            Live
          </span>
        )}
        <button className="btn btn-icon" aria-label="Open SARTHI" data-tip="Open SARTHI" onClick={() => api.copilot.act({ type: 'openDashboard' })}>
          <Icon name="grid" size={16} />
        </button>
        <button className="btn btn-icon" aria-label="Hide copilot" data-tip="Hide copilot (⌘⇧Space)" onClick={() => api.copilot.hide()}>
          <Icon name="minus" size={16} />
        </button>
      </header>
      <div className="copilot-body">
        {running && state ? (
          <LiveView
            compact
            state={state}
            status={<ListeningStatus engine={live!.engine} compact />}
            actions={{
              suggestNow: () => api.copilot.act({ type: 'suggestNow' }),
              quickType: (text) => api.copilot.act({ type: 'quickType', text }),
              end: () => api.copilot.act({ type: 'end' }),
              copy: (text) => void navigator.clipboard?.writeText(text),
              dismissError: () => api.copilot.act({ type: 'dismissError' }),
            }}
          />
        ) : state?.phase === 'ended' ? (
          <EmptyState icon="check" title="Session saved">
            The summary and phrases to practise are in SARTHI.
          </EmptyState>
        ) : (
          <EmptyState
            icon="headphones"
            title="No session running"
            action={
              <button className="btn btn-primary" onClick={() => api.copilot.act({ type: 'openDashboard' })}>
                Open SARTHI
              </button>
            }
          >
            Start a session in SARTHI before your call. Replies appear here, over any app.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Copilot />);
