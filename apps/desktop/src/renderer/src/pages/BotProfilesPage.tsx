import { useConfigStore } from '../store/configStore';

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
          <span>Type</span>
          <span>Counts</span>
          <span>Weight</span>
          <span>Tags</span>
        </div>
        {botProfiles.map((profile) => (
          <div className="table-row table-row--bot" key={profile.profileId}>
            <span>
              <strong>{profile.displayName}</strong>
              <small>{profile.description}</small>
            </span>
            <span>{profile.botType}</span>
            <span>
              {profile.recommendedMinCount}-{profile.recommendedMaxCount}
            </span>
            <span>{profile.defaultResourceWeight}</span>
            <span>{profile.tags.join(', ')}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
