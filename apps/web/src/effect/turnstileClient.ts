const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      size?: 'normal' | 'compact' | 'invisible';
      execution?: 'render' | 'execute';
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    }
  ) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | undefined;

// Module-level so Vite can inline VITE_* at build time (see vite.config / deploy workflow).
const buildTimeSiteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY;

export function turnstileSiteKey() {
  const value = buildTimeSiteKey;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function turnstileRequired() {
  return turnstileSiteKey() !== undefined;
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile="1"]'
    );
    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          resolve();
        },
        {once: true}
      );
      existing.addEventListener(
        'error',
        () => {
          reject(new Error('turnstile script failed to load'));
        },
        {once: true}
      );
      return;
    }
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = '1';
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function requestTurnstileToken(siteKey = turnstileSiteKey()) {
  if (!siteKey) return undefined;
  await loadTurnstileScript();
  const turnstile = window.turnstile;
  if (!turnstile) {
    throw new Error('turnstile is unavailable');
  }

  return new Promise<string>((resolve, reject) => {
    const container = document.createElement('div');
    container.hidden = true;
    document.body.appendChild(container);
    let settled = false;

    const cleanup = (widgetId: string) => {
      turnstile.remove(widgetId);
      container.remove();
    };

    const fail = (widgetId: string | undefined, message: string) => {
      if (settled) return;
      settled = true;
      if (widgetId) cleanup(widgetId);
      else container.remove();
      reject(new Error(message));
    };

    const succeed = (widgetId: string, token: string) => {
      if (settled) return;
      settled = true;
      cleanup(widgetId);
      resolve(token);
    };

    const widget = {id: ''};
    try {
      widget.id = turnstile.render(container, {
        sitekey: siteKey,
        size: 'invisible',
        // Defer challenge until execute(); default "render" would race widgetId assignment.
        execution: 'execute',
        callback: (token) => {
          succeed(widget.id, token);
        },
        'error-callback': () => {
          fail(widget.id, 'turnstile challenge failed');
        },
        'expired-callback': () => {
          fail(widget.id, 'turnstile token expired');
        },
      });
      turnstile.execute(widget.id);
    } catch (error: unknown) {
      fail(
        widget.id || undefined,
        error instanceof Error ? error.message : 'turnstile render failed'
      );
    }
  });
}
