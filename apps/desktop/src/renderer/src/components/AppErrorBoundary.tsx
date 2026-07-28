import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Clipboard, FolderOpen, RefreshCw } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
  componentStack?: string;
  actionMessage?: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? undefined });
    void window.gameplaySimulator.app.reportRendererError({
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    }).catch(() => undefined);
  }

  private errorDetails(): string {
    const { error, componentStack } = this.state;
    return [
      `${error?.name ?? 'Interface error'}: ${error?.message ?? 'Unknown renderer failure'}`,
      error?.stack,
      componentStack
    ].filter(Boolean).join('\n\n');
  }

  private copyDetails = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(this.errorDetails());
      this.setState({ actionMessage: 'Error details copied.' });
    } catch {
      this.setState({ actionMessage: 'The error details could not be copied automatically.' });
    }
  };

  private openLogs = async (): Promise<void> => {
    try {
      const result = await window.gameplaySimulator.app.openApplicationLogs();
      this.setState({ actionMessage: result.message });
    } catch (error) {
      this.setState({
        actionMessage: error instanceof Error ? error.message : 'Application logs could not be opened.'
      });
    }
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-error-screen" role="alert">
        <section className="app-error-panel">
          <p className="eyebrow">Interface recovery</p>
          <h1>GameplaySimulator could not show this screen</h1>
          <p>
            A part of the interface failed. Your saved profiles and run files are still on disk.
            Reload the interface, or open the application logs to inspect the failure.
          </p>
          <div className="app-error-summary">
            <strong>What failed</strong>
            <span>{this.state.error.message || 'An unexpected renderer error occurred.'}</span>
          </div>
          <div className="page-actions app-error-actions">
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={16} aria-hidden="true" />
              Reload Interface
            </button>
            <button className="secondary-button" type="button" onClick={() => void this.openLogs()}>
              <FolderOpen size={16} aria-hidden="true" />
              Open Application Logs
            </button>
            <button className="secondary-button" type="button" onClick={() => void this.copyDetails()}>
              <Clipboard size={16} aria-hidden="true" />
              Copy Error Details
            </button>
          </div>
          {this.state.actionMessage ? <p className="inline-notice">{this.state.actionMessage}</p> : null}
          <details>
            <summary>Technical details</summary>
            <pre className="code-block">{this.errorDetails()}</pre>
          </details>
        </section>
      </main>
    );
  }
}
