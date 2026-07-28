import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/global.css';

function reportUnexpectedRendererFailure(kind: string, error: unknown): void {
  const normalized = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: 'Error', message: String(error) };
  void window.gameplaySimulator.app.reportRendererError({
    kind,
    ...normalized
  }).catch(() => undefined);
}

const handleWindowError = (event: ErrorEvent): void => {
  reportUnexpectedRendererFailure('renderer_window_error', event.error ?? event.message);
};

const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
  reportUnexpectedRendererFailure('renderer_unhandled_rejection', event.reason);
};

function unregisterGlobalErrorListeners(): void {
  window.removeEventListener('error', handleWindowError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
}

window.addEventListener('error', handleWindowError);
window.addEventListener('unhandledrejection', handleUnhandledRejection);
window.addEventListener('beforeunload', unregisterGlobalErrorListeners, { once: true });
import.meta.hot?.dispose(unregisterGlobalErrorListeners);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Unable to mount GameplaySimulator: #root was not found.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
