import { Copy, FileJson, Filter, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../store/sessionStore';

type StructuredLogItem = Awaited<
  ReturnType<Window['gameplaySimulator']['simulation']['getStructuredLogs']>
>['logs'][number];

const sourceLabels: Record<StructuredLogItem['source'], string> = {
  session: 'Session',
  'bot-actions': 'Bot actions',
  'bot-states': 'Bot states',
  'bot-issues': 'Bot issues',
  instance: 'Instance'
};

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function logKey(log: StructuredLogItem, index: number): string {
  const eventId = typeof log.raw.eventId === 'string' ? log.raw.eventId : undefined;
  return eventId ?? `${log.source}:${log.botId ?? 'session'}:${log.timestamp ?? 'untimed'}:${index}`;
}

function searchableLogText(log: StructuredLogItem): string {
  return [
    log.source,
    log.eventType,
    log.timestamp,
    log.summary,
    log.botId,
    log.instanceId,
    JSON.stringify(log.raw)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return 'No timestamp';
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString();
}

export function LogsPage() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const [logs, setLogs] = useState<StructuredLogItem[]>([]);
  const [source, setSource] = useState('all');
  const [eventType, setEventType] = useState('all');
  const [botId, setBotId] = useState('all');
  const [instanceId, setInstanceId] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadMessage, setLoadMessage] = useState('');
  const [showRawJson, setShowRawJson] = useState(true);
  const [copyState, setCopyState] = useState('Copy');

  async function loadLogs(sessionId = activeSessionId) {
    if (!sessionId) {
      setLogs([]);
      setLoadState('idle');
      setLoadMessage('No active session.');
      return;
    }

    setLoadState('loading');
    try {
      const result = await window.gameplaySimulator.simulation.getStructuredLogs(sessionId);
      setLogs(result.logs);
      setLoadState('ready');
      setLoadMessage(`${result.logs.length} structured log entries loaded.`);
    } catch (error) {
      setLoadState('error');
      setLoadMessage(error instanceof Error ? error.message : 'Unable to load structured logs.');
    }
  }

  useEffect(() => {
    if (!activeSessionId) {
      setLogs([]);
      setLoadState('idle');
      setLoadMessage('No active session.');
      return undefined;
    }

    const sessionId = activeSessionId;
    let cancelled = false;

    async function refresh() {
      setLoadState((current) => (current === 'idle' ? 'loading' : current));
      try {
        const result = await window.gameplaySimulator.simulation.getStructuredLogs(sessionId);
        if (!cancelled) {
          setLogs(result.logs);
          setLoadState('ready');
          setLoadMessage(`${result.logs.length} structured log entries loaded.`);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState('error');
          setLoadMessage(error instanceof Error ? error.message : 'Unable to load structured logs.');
        }
      }
    }

    void refresh();
    const intervalId = window.setInterval(refresh, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSessionId]);

  const eventTypes = unique(logs.map((log) => log.eventType));
  const botIds = unique(logs.map((log) => log.botId));
  const instanceIds = unique(logs.map((log) => log.instanceId));
  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return logs.filter((log) => {
      if (source !== 'all' && log.source !== source) return false;
      if (eventType !== 'all' && log.eventType !== eventType) return false;
      if (botId !== 'all' && log.botId !== botId) return false;
      if (instanceId !== 'all' && log.instanceId !== instanceId) return false;
      if (normalizedQuery && !searchableLogText(log).includes(normalizedQuery)) return false;
      return true;
    });
  }, [botId, eventType, instanceId, logs, query, source]);
  const keyedLogs = useMemo(
    () => filteredLogs.map((log, index) => ({ key: logKey(log, index), log })),
    [filteredLogs]
  );
  const selectedLog = keyedLogs.find((entry) => entry.key === selectedLogKey)?.log ?? keyedLogs[0]?.log ?? null;
  const selectedKey = selectedLog ? logKey(selectedLog, keyedLogs.findIndex((entry) => entry.log === selectedLog)) : null;

  async function copyRawJson() {
    if (!selectedLog) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(selectedLog.raw, null, 2));
    setCopyState('Copied');
    window.setTimeout(() => setCopyState('Copy'), 1400);
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Inspect</p>
          <h1>Logs</h1>
        </div>
        <div className="page-actions">
          <span className="status-pill">{filteredLogs.length} visible</span>
          <button className="secondary-button" type="button" onClick={() => void loadLogs()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <section className="filter-surface" aria-label="Log filters">
        <label className="filter-field filter-field--search">
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            value={query}
            placeholder="Search logs"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="filter-field">
          <Filter size={16} aria-hidden="true" />
          <select className="input" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">All sources</option>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value)}>
            <option value="all">All event types</option>
            {eventTypes.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={botId} onChange={(event) => setBotId(event.target.value)}>
            <option value="all">All bots</option>
            {botIds.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <select className="input" value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
            <option value="all">All instances</option>
            {instanceIds.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loadMessage ? <div className={`inline-notice inline-notice--${loadState}`}>{loadMessage}</div> : null}

      <section className="review-layout review-layout--logs">
        <div className="review-list log-list" aria-label="Log entries">
          {!activeSessionId ? (
            <div className="empty-row">No active session selected</div>
          ) : keyedLogs.length === 0 ? (
            <div className="empty-row">No matching log entries</div>
          ) : (
            keyedLogs.map(({ key, log }) => (
              <button
                className="log-list-row"
                data-selected={selectedKey === key}
                type="button"
                key={key}
                onClick={() => setSelectedLogKey(key)}
              >
                <span className={`source-pill source-pill--${log.source}`}>{sourceLabels[log.source]}</span>
                <span className="log-row-main">
                  <strong>{log.eventType ?? log.source}</strong>
                  <small>{log.summary}</small>
                </span>
                <span className="log-row-meta">
                  <small>{formatTimestamp(log.timestamp)}</small>
                  <small>{log.botId ?? log.instanceId ?? 'session'}</small>
                </span>
              </button>
            ))
          )}
        </div>

        <article className="detail-surface">
          {!selectedLog ? (
            <div className="empty-state">No log selected</div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{sourceLabels[selectedLog.source]}</p>
                  <h2>{selectedLog.eventType ?? 'Log entry'}</h2>
                </div>
                <div className="page-actions">
                  <button className="secondary-button" type="button" onClick={() => setShowRawJson((value) => !value)}>
                    <FileJson size={16} aria-hidden="true" />
                    <span>{showRawJson ? 'Hide Raw JSON' : 'Open Raw JSON'}</span>
                  </button>
                  <button className="secondary-button" type="button" onClick={() => void copyRawJson()}>
                    <Copy size={16} aria-hidden="true" />
                    <span>{copyState}</span>
                  </button>
                </div>
              </div>

              <div className="issue-meta-grid">
                <div>
                  <span>Timestamp</span>
                  <strong>{formatTimestamp(selectedLog.timestamp)}</strong>
                </div>
                <div>
                  <span>Bot</span>
                  <strong>{selectedLog.botId ?? 'None'}</strong>
                </div>
                <div>
                  <span>Instance</span>
                  <strong>{selectedLog.instanceId ?? 'None'}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{sourceLabels[selectedLog.source]}</strong>
                </div>
              </div>

              <section className="detail-section">
                <h2>Summary</h2>
                <pre className="code-block">{selectedLog.summary}</pre>
              </section>

              {showRawJson ? (
                <section className="detail-section">
                  <h2>Raw JSON</h2>
                  <pre className="code-block code-block--tall">{JSON.stringify(selectedLog.raw, null, 2)}</pre>
                </section>
              ) : null}
            </>
          )}
        </article>
      </section>
    </section>
  );
}
