import type { EngineStatus } from '../audio/engine';
import { sarthi } from '../lib/bridge';
import { Banner } from './ui';

type ChipState = 'on' | 'wait' | 'error' | 'off';

function Chip({ label, state, text }: { label: string; state: ChipState; text: string }) {
  return (
    <span className={`chip chip-${state}`} role="status">
      <span className="chip-dot" aria-hidden="true" />
      {label}: {text}
    </span>
  );
}

const STREAM: Record<EngineStatus['call'], { state: ChipState; text: string }> = {
  off: { state: 'off', text: 'off' },
  starting: { state: 'wait', text: 'starting' },
  on: { state: 'on', text: 'listening' },
  error: { state: 'error', text: 'not allowed' },
};

/** What SARTHI can hear right now, with a way to fix it. */
export function ListeningStatus({ engine, compact = false }: { engine: EngineStatus; compact?: boolean }) {
  const model = engine.model;
  const modelText =
    model.state === 'ready'
      ? 'ready'
      : model.state === 'loading'
        ? model.progress > 0 && model.progress < 1
          ? `downloading ${Math.round(model.progress * 100)}%`
          : 'loading'
        : model.state === 'error'
          ? 'failed'
          : 'not loaded';
  const modelState: ChipState = model.state === 'ready' ? 'on' : model.state === 'error' ? 'error' : model.state === 'loading' ? 'wait' : 'off';
  return (
    <div className="stack">
      <div className="chips">
        <Chip label="Call" state={STREAM[engine.call].state} text={STREAM[engine.call].text} />
        <Chip label="Mic" state={STREAM[engine.mic].state} text={STREAM[engine.mic].text} />
        {!compact && <Chip label="Speech model" state={modelState} text={modelText} />}
      </div>
      {engine.callError && (
        <Banner kind="warning">
          <span>{engine.callError}</span>
          <span className="row">
            <button className="btn" onClick={() => sarthi().permissions.openSettings('screen')}>
              Open System Settings
            </button>
          </span>
        </Banner>
      )}
      {engine.micError && (
        <Banner kind="warning">
          <span>{engine.micError}</span>
          <span className="row">
            <button className="btn" onClick={() => sarthi().permissions.openSettings('microphone')}>
              Open System Settings
            </button>
          </span>
        </Banner>
      )}
      {model.state === 'error' && (
        <Banner kind="error">
          The speech model could not be loaded: {model.error}. Check the internet connection for the first download, then
          start again.
        </Banner>
      )}
    </div>
  );
}
