import { Edit3, Plus } from 'lucide-react';
import { useConfigStore } from '../store/configStore';

export function GameProfilesPage() {
  const profiles = useConfigStore((state) => state.gameProfiles);
  const openGameProfileEditor = useConfigStore((state) => state.openGameProfileEditor);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Profiles</p>
          <h1>Game Profiles</h1>
        </div>
        <button className="primary-button" type="button" onClick={() => openGameProfileEditor()}>
          <Plus size={18} aria-hidden="true" />
          <span>New Profile</span>
        </button>
      </div>

      <div className="table-surface">
        <div className="table-row table-row--head">
          <span>Game</span>
          <span>Engine</span>
          <span>Adapter</span>
          <span>Instances</span>
          <span>Evidence</span>
          <span />
        </div>
        {profiles.map((profile) => (
          <div className="table-row" key={profile.gameId}>
            <span>
              <strong>{profile.gameName}</strong>
              <small>{profile.version}</small>
            </span>
            <span>{profile.engine.type}</span>
            <span>{profile.adapter.type}</span>
            <span>{profile.adapter.supportsMultipleInstances ? 'Multiple' : 'Single'}</span>
            <span>
              {profile.adapter.supportsScreenshots ? 'Screenshots' : 'No screenshots'}
              {profile.adapter.supportsVideo ? ' + video' : ''}
            </span>
            <button
              className="icon-text-button"
              type="button"
              onClick={() => openGameProfileEditor(profile.gameId)}
            >
              <Edit3 size={16} aria-hidden="true" />
              <span>Edit</span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
