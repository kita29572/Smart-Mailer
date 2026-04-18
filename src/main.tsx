import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

// Polyfill for libraries that expect Node.js globals (secondary layer)
if (typeof window !== 'undefined') {
  // Create a safe global object that delegates to window but allows local overrides
  let fetchOverride = window.fetch.bind(window);
  const globalProxy = new Proxy(window, {
    get(target, prop) {
      if (prop === 'fetch') return fetchOverride;
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
    set(target, prop, value) {
      if (prop === 'fetch') {
        fetchOverride = value;
        return true;
      }
      try {
        (target as any)[prop] = value;
      } catch (e) {
        // Silently ignore read-only property errors
      }
      return true;
    }
  });
  
  (window as any).global = globalProxy;

  // Try to handle globalThis
  try {
    if (window.globalThis !== globalProxy) {
      Object.defineProperty(window, 'globalThis', {
        value: globalProxy,
        configurable: true,
        writable: true
      });
    }
  } catch (e) {}

  if (!(window as any).process || !(window as any).process.env) {
    (window as any).process = {
      ...(window as any).process,
      env: { NODE_ENV: (import.meta as any).env.MODE },
      browser: true,
    };
  }
}

import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
