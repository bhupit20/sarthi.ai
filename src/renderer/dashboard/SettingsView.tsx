import { useEffect, useRef, useState } from 'react';
import { loadPrepared, savePrepared } from '../../core/meeting/prepared';
import { errorMessage } from '../../core/meeting/session';
import { DEFAULT_MODELS, PAUSE_MS_MAX, PAUSE_MS_MIN } from '../../core/shared/defaults';
import { PROVIDER_IDS, PROVIDER_NAMES, type Job, type ProviderId, type Settings } from '../../core/shared/types';
import { loadProfile, loadSettings, saveProfile, saveSettings } from '../../core/storage/settings';
import type { PermissionStatus } from '../../shared/api';
import { fromWire } from '../../shared/wire';
import { sarthi } from '../lib/bridge';
import type { SessionController } from '../lib/controller';
import { discardAnswerDrafts } from '../ui/AnswersView';
import { Icon } from '../ui/icons';
import { Banner, PageHead, useConfirm } from '../ui/ui';
import type { Services } from './services';

const SECTIONS = [
  { id: 'about', title: 'About you' },
  { id: 'keys', title: 'AI providers' },
  { id: 'replies', title: 'Replies' },
  { id: 'listening', title: 'Listening' },
  { id: 'sharing', title: 'Screen sharing' },
  { id: 'data', title: 'Your data' },
  { id: 'danger', title: 'Danger zone' },
] as const;

const JOBS: Array<{ job: Job; label: string; hint: string }> = [
  { job: 'live', label: 'Live replies', hint: 'Used during the call. Pick a fast model.' },
  { job: 'summary', label: 'Summary', hint: 'Used once after each session. Can be a stronger model.' },
];

const PERMISSION_TEXT: Record<string, string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  'not-determined': 'Not asked yet',
  restricted: 'Blocked by your Mac’s settings',
  unknown: 'Unknown',
};

export function SettingsView({ services, controller }: { services: Services; controller: SessionController }) {
  const { kv, deps } = services;
  const confirm = useConfirm();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState('');
  const [hasKey, setHasKey] = useState<Record<ProviderId, boolean> | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [keyStatus, setKeyStatus] = useState<Partial<Record<ProviderId, string>>>({});
  const [models, setModels] = useState<Partial<Record<Job, string[]>>>({});
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshPermissions = () => void sarthi().permissions.status().then(setPermissions);

  useEffect(() => {
    void Promise.all([loadSettings(kv), loadProfile(kv), sarthi().keys.status()]).then(([s, p, k]) => {
      setSettings(s);
      setProfile(p.text);
      setHasKey(k);
    });
    refreshPermissions();
    return () => clearTimeout(savedTimer.current);
  }, [kv]);

  if (!settings || !hasKey) return <p className="muted">Loading…</p>;

  const flashSaved = () => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1500);
  };
  const update = (next: Settings) => {
    setSettings(next);
    void saveSettings(kv, next).then(flashSaved);
  };

  const saveKey = async (id: ProviderId) => {
    const value = (drafts[id] ?? '').trim();
    if (!value) {
      setKeyStatus((s) => ({ ...s, [id]: 'Paste the key first.' }));
      return;
    }
    const failure = await sarthi().keys.set(id, value);
    if (failure) {
      setKeyStatus((s) => ({ ...s, [id]: fromWire(failure).message }));
      return;
    }
    const keys = { ...hasKey, [id]: true };
    setHasKey(keys);
    setDrafts((d) => ({ ...d, [id]: '' }));
    setKeyStatus((s) => ({ ...s, [id]: 'Saved in your Keychain.' }));
    // The first key is used for both jobs, so one key is enough to start.
    let next = settings;
    for (const job of ['live', 'summary'] as const) {
      // A job whose provider had no key moves to the provider just added.
      if (!hasKey[next[job].provider]) {
        next = { ...next, [job]: { provider: id, model: DEFAULT_MODELS[id][job] } };
      }
    }
    if (next !== settings) update(next);
  };

  const removeKey = async (id: ProviderId) => {
    if (!(await confirm(`The ${PROVIDER_NAMES[id]} key will be removed from this Mac.`, 'Remove key'))) return;
    await sarthi().keys.set(id, '');
    setHasKey({ ...hasKey, [id]: false });
    setKeyStatus((s) => ({ ...s, [id]: 'Removed.' }));
  };

  const testKey = async (id: ProviderId) => {
    setKeyStatus((s) => ({ ...s, [id]: 'Testing…' }));
    const model = settings.live.provider === id ? settings.live.model : DEFAULT_MODELS[id].live;
    const failure = await sarthi().ai.test(id, model);
    setKeyStatus((s) => ({ ...s, [id]: failure ? errorMessage(fromWire(failure)) || fromWire(failure).message : 'Works' }));
  };

  const loadModels = async (job: Job) => {
    const result = await sarthi().ai.models(settings[job].provider);
    if (result.models) {
      setModels({ ...models, [job]: result.models });
      setNote('Model list loaded. Click the model box to choose.');
    } else {
      setNote(result.error ? fromWire(result.error).message : 'Could not load the model list.');
    }
  };

  const jumpTo = (id: string) => {
    const section = document.getElementById(`settings-${id}`);
    if (!section) return;
    window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 40 });
    section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };

  const exportData = async () => {
    const [p, preparedAnswers, data] = await Promise.all([loadProfile(kv), loadPrepared(kv), deps.db.exportAll()]);
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), profile: p, preparedAnswers, ...data }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sarthi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const model = controller.transcriber.getStatus();

  return (
    <div className="column">
      <PageHead title="Settings" description="Changes save on their own." />
      <nav className="section-nav" aria-label="Jump to a section">
        {SECTIONS.map((s) => (
          <button key={s.id} className="btn-link" onClick={() => jumpTo(s.id)}>
            {s.title}
          </button>
        ))}
      </nav>
      <p className="saved" aria-live="polite">
        {saved ? 'Saved' : ' '}
      </p>
      {note && (
        <Banner kind="info" onDismiss={() => setNote(null)}>
          {note}
        </Banner>
      )}

      <section className="settings-section" id="settings-about" aria-labelledby="h-about">
        <h2 id="h-about" tabIndex={-1}>
          About you
        </h2>
        <div className="field">
          <label className="field-label" htmlFor="about-me">
            About me
          </label>
          <textarea
            id="about-me"
            value={profile}
            placeholder="Your work, services, prices, how you like to work. SARTHI uses this in every reply."
            onChange={(e) => {
              setProfile(e.target.value);
              void saveProfile(kv, { text: e.target.value }).then(flashSaved);
            }}
          />
        </div>
      </section>

      <section className="settings-section" id="settings-keys" aria-labelledby="h-keys">
        <h2 id="h-keys" tabIndex={-1}>
          AI providers
        </h2>
        <p className="muted">
          Add at least one API key. Keys are encrypted with your Mac’s Keychain and are never shown again or exported. NVIDIA and
          Gemini offer free keys for testing.
        </p>
        {PROVIDER_IDS.map((id) => (
          <div className="field" key={id}>
            <label className="field-label" htmlFor={`key-${id}`}>
              {PROVIDER_NAMES[id]} API key
            </label>
            <div className="row">
              <input
                id={`key-${id}`}
                className="grow"
                type="password"
                autoComplete="off"
                value={drafts[id] ?? ''}
                placeholder={hasKey[id] ? 'Saved. Paste a new key to replace it.' : 'Paste your key'}
                onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveKey(id);
                }}
              />
              <button className="btn" onClick={() => void saveKey(id)}>
                Save key
              </button>
              {hasKey[id] && (
                <>
                  <button className="btn" aria-label={`Test ${PROVIDER_NAMES[id]} key`} onClick={() => void testKey(id)}>
                    Test
                  </button>
                  <button
                    className="btn btn-icon"
                    aria-label={`Remove ${PROVIDER_NAMES[id]} key`}
                    data-tip={`Remove ${PROVIDER_NAMES[id]} key`}
                    onClick={() => void removeKey(id)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </>
              )}
            </div>
            {(keyStatus[id] || hasKey[id]) && (
              <span className={`status-text${keyStatus[id] === 'Works' || (!keyStatus[id] && hasKey[id]) ? ' status-ok' : ''}`} role="status">
                {keyStatus[id] ?? 'Saved in your Keychain.'}
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="settings-section" id="settings-replies" aria-labelledby="h-replies">
        <h2 id="h-replies" tabIndex={-1}>
          Replies
        </h2>
        <div className="field">
          <label className="field-label" htmlFor="reply-to">
            Suggest replies for
          </label>
          <select
            id="reply-to"
            value={settings.replyTo}
            onChange={(e) => update({ ...settings, replyTo: e.target.value as Settings['replyTo'] })}
          >
            <option value="questions">Everything except small talk</option>
            <option value="everything">Everything the client says</option>
          </select>
          <span className="field-help">Small talk is “okay”, “thanks”, “bye” and similar. ⌘⇧↵ gives replies at any time.</span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pause">
            Wait after the client stops: {(settings.pauseMs / 1000).toFixed(1)} s
          </label>
          <input
            id="pause"
            type="range"
            min={PAUSE_MS_MIN}
            max={PAUSE_MS_MAX}
            step={100}
            value={settings.pauseMs}
            onChange={(e) => update({ ...settings, pauseMs: Number(e.target.value) })}
          />
          <span className="field-help">Shorter is faster but may cut the client off mid-sentence. Applies from the next session.</span>
        </div>
        {JOBS.map(({ job, label, hint }) => (
          <div className="card stack" key={job}>
            <div>
              <h3 className="card-title">{label}</h3>
              <p className="muted">{hint}</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`provider-${job}`}>
                {label} provider
              </label>
              <select
                id={`provider-${job}`}
                value={settings[job].provider}
                onChange={(e) => {
                  const provider = e.target.value as ProviderId;
                  setModels({ ...models, [job]: undefined });
                  update({ ...settings, [job]: { provider, model: DEFAULT_MODELS[provider][job] } });
                }}
              >
                {PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_NAMES[id]}
                    {hasKey[id] ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`model-${job}`}>
                {label} model
              </label>
              <div className="row">
                <input
                  id={`model-${job}`}
                  className="grow"
                  type="text"
                  list={`models-${job}`}
                  value={settings[job].model}
                  onChange={(e) => update({ ...settings, [job]: { ...settings[job], model: e.target.value } })}
                />
                <button className="btn" onClick={() => void loadModels(job)}>
                  Load models
                </button>
              </div>
              <datalist id={`models-${job}`}>
                {(models[job] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section" id="settings-listening" aria-labelledby="h-listening">
        <h2 id="h-listening" tabIndex={-1}>
          Listening
        </h2>
        <p className="muted">
          SARTHI hears the client through your Mac’s sound output and you through the microphone. Speech is turned into text on
          this Mac; audio never leaves it. Headphones give the cleanest result.
        </p>
        <ul className="checklist">
          <li>
            <span className="check-body">
              <span className="check-title">Call audio</span>
              <span className="check-help" style={{ display: 'block' }}>
                Screen &amp; System Audio Recording: {PERMISSION_TEXT[permissions?.screen ?? 'unknown']}
              </span>
            </span>
            <button className="btn" onClick={() => sarthi().permissions.openSettings('screen')}>
              Open settings
            </button>
          </li>
          <li>
            <span className="check-body">
              <span className="check-title">Microphone</span>
              <span className="check-help" style={{ display: 'block' }}>
                {PERMISSION_TEXT[permissions?.microphone ?? 'unknown']}
              </span>
            </span>
            {permissions?.microphone === 'not-determined' ? (
              <button className="btn" onClick={() => void sarthi().permissions.requestMicrophone().then(refreshPermissions)}>
                Allow
              </button>
            ) : (
              <button className="btn" onClick={() => sarthi().permissions.openSettings('microphone')}>
                Open settings
              </button>
            )}
          </li>
          <li>
            <span className="check-body">
              <span className="check-title">Speech model (Whisper, English)</span>
              <span className="check-help" style={{ display: 'block' }}>
                {model.state === 'ready'
                  ? `Ready, running on ${model.device === 'webgpu' ? 'the Mac’s graphics chip' : 'the processor'}.`
                  : model.state === 'loading'
                    ? 'Downloading…'
                    : model.state === 'error'
                      ? `Could not load: ${model.error}`
                      : 'Downloads once, about 80 MB.'}
              </span>
            </span>
            {model.state !== 'ready' && model.state !== 'loading' && (
              <button className="btn" onClick={() => void controller.transcriber.load().catch(() => {})}>
                Download
              </button>
            )}
          </li>
        </ul>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.listenToMic}
            onChange={(e) => update({ ...settings, listenToMic: e.target.checked })}
          />
          <span>
            <strong>Listen to my microphone</strong>
            <span className="field-help" style={{ display: 'block' }}>
              Shows your own words in the conversation. Turn off if you only want the client’s side. Applies from the next session.
            </span>
          </span>
        </label>
      </section>

      <section className="settings-section" id="settings-sharing" aria-labelledby="h-sharing">
        <h2 id="h-sharing" tabIndex={-1}>
          Screen sharing
        </h2>
        <p className="muted">
          SARTHI asks macOS to keep its windows out of screen shares and recordings. Some apps capture the screen in a way macOS
          does not block, so for the safest result share a single window or browser tab, not your entire screen.
        </p>
        <ul className="checklist">
          <li>
            <span className="check-body">
              <span className="check-title">Safest: share one window or tab</span>
              <span className="check-help" style={{ display: 'block' }}>
                The client sees only that window. The copilot floats above it, unseen.
              </span>
            </span>
          </li>
          <li>
            <span className="check-body">
              <span className="check-title">Entire screen: check first</span>
              <span className="check-help" style={{ display: 'block' }}>
                Before an important call, share your screen with yourself (or a colleague) to see whether the copilot shows.
              </span>
            </span>
          </li>
        </ul>
      </section>

      <section className="settings-section" id="settings-data" aria-labelledby="h-data">
        <h2 id="h-data" tabIndex={-1}>
          Your data
        </h2>
        <p className="muted">Clients, sessions and answers are stored only on this Mac.</p>
        <button className="btn align-start" onClick={() => void exportData()}>
          <Icon name="download" size={16} />
          Export my data
        </button>
      </section>

      <section className="settings-section" id="settings-danger" aria-labelledby="h-danger">
        <div className="danger-zone stack">
          <h2 id="h-danger" tabIndex={-1}>
            Danger zone
          </h2>
          <p className="muted">Deletes all clients, notes, sessions, prepared answers and your profile. API keys are kept.</p>
          <button
            className="btn btn-danger align-start"
            onClick={async () => {
              if (!(await confirm('All clients, notes, sessions, prepared answers and your profile will be deleted. API keys are kept. This cannot be undone.', 'Delete all data'))) return;
              discardAnswerDrafts();
              await Promise.all([deps.db.deleteAll(), saveProfile(kv, { text: '' }), savePrepared(kv, [])]);
              setProfile('');
              setNote('All data deleted.');
            }}
          >
            <Icon name="trash" size={16} />
            Delete all data
          </button>
        </div>
      </section>
    </div>
  );
}
