import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildQuickTypeUser } from '../../core/meeting/prompts';
import { SessionController } from '../lib/controller';
import { sarthi } from '../lib/bridge';
import { AnswersView } from '../ui/AnswersView';
import { ClientsView } from '../ui/ClientsView';
import { Icon, type IconName } from '../ui/icons';
import { PracticeView } from '../ui/PracticeView';
import { ConfirmProvider } from '../ui/ui';
import { HomeView } from './HomeView';
import { LiveScreen } from './LiveScreen';
import type { Services } from './services';
import { SettingsView } from './SettingsView';

export type View = 'home' | 'live' | 'clients' | 'answers' | 'practice' | 'settings';

const NAV: Array<{ group: string; items: Array<{ view: View; label: string; icon: IconName }> }> = [
  {
    group: 'Calls',
    items: [
      { view: 'home', label: 'Home', icon: 'grid' },
      { view: 'live', label: 'Live session', icon: 'radio' },
    ],
  },
  {
    group: 'Memory',
    items: [
      { view: 'clients', label: 'Clients', icon: 'users' },
      { view: 'answers', label: 'Answers', icon: 'message' },
      { view: 'practice', label: 'Practice', icon: 'book' },
    ],
  },
  { group: 'App', items: [{ view: 'settings', label: 'Settings', icon: 'settings' }] },
];

export function App({ services }: { services: Services }) {
  const [view, setView] = useState<View>('home');
  const controller = useMemo(() => new SessionController(services.deps), [services]);
  const live = useSyncExternalStore(
    (fn) => controller.subscribe(fn),
    () => controller.get(),
  );
  const isLive = live.session?.phase === 'live' || live.session?.phase === 'ending';

  // The copilot window and the global shortcuts drive the same session.
  useEffect(() => {
    const api = sarthi();
    const offAction = api.copilot.onAction((action) => {
      if (action.type === 'suggestNow') void controller.suggestNow();
      else if (action.type === 'quickType') controller.quickType(action.text);
      else if (action.type === 'end') void controller.end();
      else if (action.type === 'dismissError') controller.dismissError();
    });
    const offShortcut = api.onShortcut((shortcut) => {
      if (shortcut === 'suggest') void controller.suggestNow();
    });
    api.copilot.publish(controller.get());
    return () => {
      offAction();
      offShortcut();
    };
  }, [controller]);

  const listMeetings = useCallback(async () => (await services.deps.db.exportAll()).meetings, [services]);
  const listClients = useCallback(() => services.deps.db.listClients(), [services]);

  /** Translate and polish a prepared answer, outside any session. */
  const translate = useCallback(
    async (text: string) => {
      let english = '';
      await services.deps.run(
        'live',
        {
          system: 'I am a professional preparing answers for calls with my clients. English is my second language.',
          user: buildQuickTypeUser([], '', text),
          maxTokens: 1024,
        },
        await services.deps.getSettings(),
        { onDelta: (t) => (english += t), onProvider: () => {} },
      );
      return english;
    },
    [services],
  );

  return (
    <ConfirmProvider>
      <div className="shell">
        <aside className="sidebar" aria-label="SARTHI.AI">
          <div className="logo">
            <span className="logo-mark">
              <Icon name="headphones" size={18} />
            </span>
            <span>
              <span className="logo-name">SARTHI.AI</span>
              <span className="logo-sub">Your call copilot</span>
            </span>
          </div>
          <nav aria-label="Sections">
            {NAV.map((group) => (
              <div className="nav-group" key={group.group}>
                <span className="nav-label">{group.group}</span>
                {group.items.map((item) => (
                  <button
                    key={item.view}
                    className="nav-item"
                    aria-current={view === item.view ? 'page' : undefined}
                    onClick={() => setView(item.view)}
                  >
                    <Icon name={item.icon} size={18} />
                    <span className="grow">{item.label}</span>
                    {item.view === 'live' && isLive && <span className="live-dot" aria-label="Live" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-card">
            <strong>Copilot</strong>
            <p className="field-help">
              Floating replies over any app. <kbd>⌘⇧Space</kbd> shows or hides it.
            </p>
            <button className="btn" onClick={() => sarthi().copilot.toggle()}>
              <Icon name="externalLink" size={16} />
              Show or hide copilot
            </button>
          </div>
        </aside>

        <div className="content">
          <div className="drag-strip" aria-hidden="true" />
          {view === 'home' && (
            <main>
              <HomeView
                services={services}
                controller={controller}
                live={live}
                onNavigate={setView}
              />
            </main>
          )}
          {view === 'live' && (
            <main>
              <LiveScreen controller={controller} live={live} onNavigate={setView} />
            </main>
          )}
          {view === 'clients' && (
            <main>
              <ClientsView deps={services.deps} onStartMeeting={() => setView('home')} />
            </main>
          )}
          {view === 'answers' && (
            <main>
              <AnswersView kv={services.kv} translate={translate} />
            </main>
          )}
          {view === 'practice' && (
            <main>
              <PracticeView listMeetings={listMeetings} listClients={listClients} onStartMeeting={() => setView('home')} />
            </main>
          )}
          {view === 'settings' && (
            <main>
              <SettingsView services={services} controller={controller} />
            </main>
          )}
        </div>
      </div>
    </ConfirmProvider>
  );
}
