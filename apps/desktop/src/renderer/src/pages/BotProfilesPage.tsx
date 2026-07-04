import { useConfigStore } from '../store/configStore';

function percent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export function BotProfilesPage() {
  const botProfiles = useConfigStore((state) => state.botProfiles);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Profiles</p>
          <h1>Bot Profiles</h1>
        </div>
      </div>

      <div className="table-surface table-surface--compact">
        <div className="table-row table-row--head table-row--bot">
          <span>Bot</span>
          <span>Playstyle</span>
          <span>Traits</span>
          <span>Actions</span>
          <span>Counts</span>
        </div>
        {botProfiles.map((profile) => (
          <div className="table-row table-row--bot" key={profile.profileId}>
            <span>
              <strong>{profile.displayName}</strong>
              <small>{profile.description}</small>
            </span>
            <span>
              {profile.playstyle ?? profile.botType}
              <small>{profile.tags.join(', ')}</small>
            </span>
            <span>
              A {percent(profile.aggression)} / C {percent(profile.curiosity)}
              <small>
                Risk {percent(profile.riskTolerance)} / Bugs {percent(profile.bugHuntingBias)}
              </small>
            </span>
            <span>
              {profile.preferredActions?.slice(0, 3).join(', ') ?? 'Any'}
              <small>Avoids {profile.avoidedActions?.slice(0, 2).join(', ') ?? 'None'}</small>
            </span>
            <span>
              {profile.recommendedMinCount}-{profile.recommendedMaxCount}
              <small>
                {profile.defaultResourceWeight} / {profile.goals.length} goal
                {profile.goals.length === 1 ? '' : 's'}
              </small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
