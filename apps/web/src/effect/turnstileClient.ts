import {
  TURNSTILE_CLIENT_MAX_ATTEMPTS,
  turnstileClientRetryDelayMs,
} from '../pure/turnstileRetry.js';

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
      'error-callback'?: (errorCode?: string) => boolean;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
    }
  ) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | undefined;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Module-level so Vite can inline VITE_* at build time (see vite.config / deploy workflow).
function readBuildTimeSiteKey() {
  // Vite inlines VITE_* at build time; node:test may run without import.meta.env.
  const env = (import.meta as {env?: ImportMetaEnv}).env;
  if (env === undefined) return undefined;
  const value = env.VITE_TURNSTILE_SITE_KEY;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const buildTimeSiteKey = readBuildTimeSiteKey();

export function turnstileSiteKey() {
  return buildTimeSiteKey;
}

export function turnstileRequired() {
  return turnstileSiteKey() !== undefined;
}

export function preloadTurnstileScript() {
  if (!turnstileRequired()) return Promise.resolve();
  return loadTurnstileScript();
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile="1"]'
    );
    if (existing) {
      if (existing.dataset.loaded === '1' || window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener(
        'load',
        () => {
          existing.dataset.loaded = '1';
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
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => {
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function requestTurnstileTokenOnce(siteKey: string) {
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
    let widgetId = '';

    const cleanup = () => {
      if (widgetId) turnstile.remove(widgetId);
      container.remove();
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const succeed = (token: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };

    const retryExecute = () => {
      if (settled || !widgetId) return;
      try {
        turnstile.reset(widgetId);
        turnstile.execute(widgetId);
      } catch (error: unknown) {
        fail(
          error instanceof Error ? error.message : 'turnstile execute failed'
        );
      }
    };

    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        size: 'invisible',
        // Defer challenge until execute(); default "render" would race widgetId assignment.
        execution: 'execute',
        callback: (token) => {
          succeed(token);
        },
        'error-callback': () => {
          fail('turnstile challenge failed');
          return true;
        },
        'expired-callback': () => {
          fail('turnstile token expired');
        },
        'timeout-callback': () => {
          retryExecute();
        },
      });
      turnstile.execute(widgetId);
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : 'turnstile render failed');
    }
  });
}

export async function requestTurnstileToken(siteKey = turnstileSiteKey()) {
  if (!siteKey) return undefined;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= TURNSTILE_CLIENT_MAX_ATTEMPTS; attempt++) {
    try {
      return await requestTurnstileTokenOnce(siteKey);
    } catch (error: unknown) {
      lastError =
        error instanceof Error
          ? error
          : new Error('turnstile challenge failed');
      if (attempt < TURNSTILE_CLIENT_MAX_ATTEMPTS) {
        await sleep(turnstileClientRetryDelayMs(attempt));
      }
    }
  }

  throw lastError ?? new Error('turnstile challenge failed');
}
