import { createRoot } from 'react-dom/client';
import '../ui/base.css';
import '../ui/app.css';
import { App } from './App';
import { createServices } from './services';

const root = createRoot(document.getElementById('root')!);
createServices().then(
  (services) => root.render(<App services={services} />),
  () => root.render(<p className="banner banner-error">SARTHI could not open its storage. Quit and open it again.</p>),
);
