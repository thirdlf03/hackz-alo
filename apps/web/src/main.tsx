import {render} from 'preact';
import {
  preloadTurnstileScript,
  turnstileRequired,
} from './effect/turnstileClient.js';
import {App} from './app/App.js';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';

if (turnstileRequired()) {
  void preloadTurnstileScript();
}

const perfEnabled =
  import.meta.env.VITE_INCIDENT_PERF === '1' ||
  import.meta.env.VITE_INCIDENT_PERF === 'true' ||
  new URLSearchParams(window.location.search).get('perf') === '1';

if (perfEnabled) {
  const {initBrowserPerf} = await import('@incident/observability/browser');
  initBrowserPerf({
    enabled: true,
    exporter:
      import.meta.env.VITE_INCIDENT_PERF === 'console' ? 'console' : 'memory',
    serviceName: 'incident-web',
  });
}

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app element not found');
}
render(<App />, root);
