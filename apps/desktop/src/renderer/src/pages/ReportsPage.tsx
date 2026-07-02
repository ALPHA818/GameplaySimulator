import { useConfigStore } from '../store/configStore';

export function ReportsPage() {
  const runConfigs = useConfigStore((state) => state.runConfigs);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Output</p>
          <h1>Reports</h1>
        </div>
      </div>

      <div className="table-surface">
        <div className="table-row table-row--head table-row--report">
          <span>Session</span>
          <span>Profile</span>
          <span>Mode</span>
          <span>Bots</span>
          <span>Evidence</span>
        </div>
        {runConfigs.length === 0 ? (
          <div className="empty-row">No reports yet</div>
        ) : (
          runConfigs.map((config) => {
            const botCount = config.botPools.reduce(
              (total, pool) => total + (pool.enabled ? pool.desiredCount : 0),
              0
            );

            return (
              <div className="table-row table-row--report" key={config.sessionId}>
                <span>{config.sessionId}</span>
                <span>{config.gameProfilePath.replace('memory://game-profiles/', '')}</span>
                <span>{config.runMode}</span>
                <span>{botCount}</span>
                <span>
                  {config.saveScreenshots ? 'Screenshots' : 'No screenshots'}
                  {config.saveVideo ? ' + video' : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
