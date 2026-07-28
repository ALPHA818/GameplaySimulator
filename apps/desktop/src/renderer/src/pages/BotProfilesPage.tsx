import {
  botCompatibilityEvaluator,
  type BotCompatibilityResult
} from '@core/bot/BotCompatibilityEvaluator';
import type { BotProfile, BotSpecializationCategory } from '@core/types';
import { Copy, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FieldLabel } from '../components/FormFields';
import { useConfigStore } from '../store/configStore';

type SpecializedFilter = 'all' | BotSpecializationCategory;

const categoryOptions: Array<{ value: SpecializedFilter; label: string }> = [
  { value: 'all', label: 'All Specialized Bots' },
  { value: 'gameplay-systems', label: 'Gameplay Systems' },
  { value: 'ui-input', label: 'UI And Input' },
  { value: 'content-progression', label: 'Content And Progression' },
  { value: 'performance-stability', label: 'Performance And Stability' },
  { value: 'persistence', label: 'Saves And Persistence' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'network-multiplayer', label: 'Network And Multiplayer' },
  { value: 'world-simulation', label: 'World Simulation' },
  { value: 'platform', label: 'Platform-Specific' },
  { value: 'engine-specific', label: 'Engine-Specific' }
];

const categoryLabels = Object.fromEntries(
  categoryOptions.filter((option) => option.value !== 'all').map((option) => [option.value, option.label])
) as Record<BotSpecializationCategory, string>;

function textList(values: string[] | undefined, emptyText: string): string {
  return values && values.length > 0 ? values.join(', ') : emptyText;
}

function issueCategories(profile: BotProfile): string[] {
  return [...new Set(profile.goals.flatMap((goal) => goal.targetIssueCategories))];
}

function compatibilityStatusLabel(status: BotCompatibilityResult['status']): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function ProfileRow({
  profile,
  compatibility
}: {
  profile: BotProfile;
  compatibility?: BotCompatibilityResult;
}) {
  const addBotProfileToSession = useConfigStore((state) => state.addBotProfileToSession);
  const cloneBotProfile = useConfigStore((state) => state.cloneBotProfile);
  const openBotProfileEditor = useConfigStore((state) => state.openBotProfileEditor);
  const category = categoryLabels[profile.specializationCategory ?? 'gameplay-systems'];

  return (
    <details
      className="bot-profile-card"
      data-profile-group={profile.profileGroup}
      data-compatibility-status={compatibility?.status}
    >
      <summary className="bot-profile-card__summary">
        <span className="bot-profile-card__identity">
          <strong>{profile.displayName}</strong>
          <small>{profile.description ?? profile.playstyle ?? profile.botType}</small>
        </span>
        <span className="bot-profile-card__badges">
          {profile.beginnerRecommended ? <span className="status-pill">Beginner friendly</span> : null}
          {compatibility ? <span className="status-pill">{compatibilityStatusLabel(compatibility.status)}</span> : null}
          <span className="status-pill">{category}</span>
          <span className="status-pill">{profile.defaultResourceWeight}</span>
        </span>
      </summary>

      <div className="bot-profile-card__details">
        {compatibility && (
          compatibility.missingRequirements.length > 0 ||
          compatibility.expectedLimitations.length > 0
        ) ? (
          <div
            className={`notice-list ${compatibility.status === 'unsupported' ? 'notice-list--blocker' : 'notice-list--warning'}`}
            aria-label={`${profile.displayName} compatibility`}
          >
            <strong>{compatibility.status === 'unsupported' ? 'This profile is unsupported for the selected game profile.' : 'This profile has missing requirements or expected limitations.'}</strong>
            {[...compatibility.missingRequirements, ...compatibility.expectedLimitations]
              .map((message) => <span key={message}>{message}</span>)}
          </div>
        ) : null}
        {compatibility ? (
          <div className="bot-profile-detail-grid bot-profile-compatibility-grid">
            <div>
              <FieldLabel
                label="Compatible With Selected Game"
                helpText="This tells you how well this bot matches the game profile chosen above. Recommended means the game clearly contains useful matching features. Compatible means it should work but is not a top suggestion. Limited means setup or evidence is missing. Unsupported means it should not be used yet. Beginners should start with Recommended bots."
              />
              <strong>{compatibilityStatusLabel(compatibility.status)}</strong>
            </div>
            <div>
              <FieldLabel
                label="Why Recommended"
                helpText="This explains which game features made the bot a useful suggestion. The evaluator checks controls, known content, signals, UI flows, saves, and adapter features. For example, crafting recipes can recommend Crafting Tester. If this says no strong match, the bot may still work but is not a first choice."
              />
              <strong>{textList(compatibility.whyRecommended, 'No strong feature match was found.')}</strong>
            </div>
            <div>
              <FieldLabel
                label="Missing Requirements"
                helpText="These are game or adapter features the bot still needs. For example, Touch Tester needs mapped touch controls, and Multiplayer Tester needs controlled network instrumentation. If something is missing, the test may be limited or blocked. Beginners should fix these items before adding the bot."
              />
              <strong>{textList(compatibility.missingRequirements, 'No missing requirements detected.')}</strong>
            </div>
            <div>
              <FieldLabel
                label="Expected Limitations"
                helpText="These are results the bot cannot fully prove with the current profile. For example, audio may need a person to listen, and screenshot-only tests have weaker state awareness. The bot can still be useful when marked Limited, but the report may be incomplete. Beginners should read these notes before running."
              />
              <strong>{textList(compatibility.expectedLimitations, 'No special limitations detected for this game profile.')}</strong>
            </div>
          </div>
        ) : null}
        <div className="bot-profile-detail-grid">
          <div>
            <FieldLabel
              label="Purpose"
              helpText="This is the main job of the bot. The simulator uses the profile rules to choose actions that fit this job. For example, an Explorer looks for new paths. If the purpose does not match your goal, choose another bot. Beginners should start with one simple purpose."
            />
            <strong>{textList(profile.bestUsedFor, profile.description ?? 'General game testing')}</strong>
          </div>
          <div>
            <FieldLabel
              label="Beginner Guide"
              helpText="This gives a simple way to start using this bot. It explains useful setup and a safe first run. For example, it may suggest one bot and a disposable save. Ignoring this can make a specialized test harder to understand. Beginners should follow this advice before increasing bot counts."
            />
            <strong>{profile.beginnerExplanation ?? (profile.beginnerRecommended
              ? 'This profile is suitable for a small first test with one bot.'
              : 'Start with one bot and confirm the required game actions before a longer test.')}</strong>
          </div>
          <div>
            <FieldLabel
              label="Specialization Category"
              helpText="This groups bots that test similar parts of a game. It helps you find a focused tester, such as UI And Input or Saves And Persistence. For example, Combat Tester is under Gameplay Systems. Choosing the wrong category only makes the bot harder to find. Beginners can use General-Purpose Bots first."
            />
            <strong>{category}</strong>
          </div>
          <div>
            <FieldLabel
              label="Supported Game Types"
              helpText="These are the kinds of games where this bot is usually useful. The adapter still decides which actions are really available. For example, desktop, browser, Unity, or Godot may be listed. A listed type does not guarantee every feature works. Beginners should also check Required Capabilities."
            />
            <strong>{textList(profile.recommendedGameTypes, 'Any controlled game')}</strong>
          </div>
          <div>
            <FieldLabel
              label="Required Capabilities"
              helpText="These are the game or adapter features the bot needs to do useful work. For example, a save tester needs save and load actions. If the adapter cannot provide them, the bot may wait or skip the test. Beginners should choose bots whose requirements appear in the profile test results."
            />
            <strong>{textList(profile.requiredCapabilities, 'No special capability')}</strong>
          </div>
          <div>
            <FieldLabel
              label="Resource Weight"
              helpText="This estimates how much extra CPU and RAM the bot may use. Light bots are cheaper, while heavy bots may read more state or perform demanding actions. The bot does not open another game window by itself; the adapter and session settings control windows. Beginners should use light or medium bots first."
            />
            <strong>{profile.defaultResourceWeight.replace('_', ' ')}</strong>
          </div>
          <div>
            <FieldLabel
              label="Recommended Bot Count"
              helpText="This is the useful count range for this profile. The Resource Manager may recommend fewer bots if CPU or RAM is busy. For example, 1 to 4 means start with one and scale carefully. A large count can slow the computer. Beginners should use the lowest number."
            />
            <strong>{profile.recommendedMinCount} to {profile.recommendedMaxCount}</strong>
          </div>
          <div>
            <FieldLabel
              label="Estimated Complexity"
              helpText="This tells you how much setup the bot usually needs. Low is easy, while advanced may need structured game state, special actions, or careful saves. If setup is missing, the bot may not complete its goal. Beginners should choose low or medium complexity."
            />
            <strong>{profile.estimatedComplexity ?? 'medium'}</strong>
          </div>
          <div>
            <FieldLabel
              label="Incompatible Game Types"
              helpText="These are game types or situations where this bot should not be used. For example, public multiplayer is outside this QA tool's scope. If your game matches this list, choose another profile. Beginners should leave incompatible bots out of the session."
            />
            <strong>{textList(profile.incompatibleGameTypes, 'None known')}</strong>
          </div>
        </div>

        <div className="bot-profile-detail-grid bot-profile-detail-grid--wide">
          <div>
            <FieldLabel
              label="Limitations"
              helpText="This explains what the bot cannot test well. It helps you avoid trusting a weak result. For example, a quest bot may need structured quest state. Ignoring a limitation can make a failed test confusing. Beginners should read this before adding a specialized bot."
            />
            <span>{textList(profile.limitations, 'No special limitations recorded.')}</span>
          </div>
          <div>
            <FieldLabel
              label="Preferred Actions"
              helpText="These are actions this bot likes to choose when the game reports them as available. For example, a UI bot may prefer open-menu and confirm-dialog. The bot never invents an unsupported action. If these actions are missing, the profile may be less useful."
            />
            <span>{textList(profile.preferredActions, 'Any available action')}</span>
          </div>
          <div>
            <FieldLabel
              label="Issue Categories"
              helpText="These are the problem types this bot is designed to notice. For example, crash, progression, input, or save/load. Other issues may still be found. If the category does not match what you need tested, choose a different bot. Beginners can start with crash and progression coverage."
            />
            <span>{textList(issueCategories(profile), 'General issues')}</span>
          </div>
        </div>

        <div className="bot-profile-card__actions">
          {profile.profileGroup === 'custom' ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => openBotProfileEditor(profile.profileId)}
            >
              <Pencil size={16} aria-hidden="true" />
              <span>Edit Profile</span>
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={() => cloneBotProfile(profile.profileId)}
          >
            <Copy size={16} aria-hidden="true" />
            <span>Clone Profile</span>
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={compatibility?.status === 'unsupported'}
            onClick={() => addBotProfileToSession(profile.profileId)}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add To Session</span>
          </button>
        </div>
      </div>
    </details>
  );
}

function ProfileSection({
  title,
  description,
  profiles,
  emptyText,
  compatibilityById
}: {
  title: string;
  description: string;
  profiles: BotProfile[];
  emptyText: string;
  compatibilityById: Map<string, BotCompatibilityResult>;
}) {
  return (
    <section className="bot-profile-section" aria-labelledby={`profile-group-${title.replaceAll(' ', '-').toLowerCase()}`}>
      <div className="section-heading">
        <div>
          <h2 id={`profile-group-${title.replaceAll(' ', '-').toLowerCase()}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="status-pill">{profiles.length} profile{profiles.length === 1 ? '' : 's'}</span>
      </div>
      <div className="bot-profile-list">
        {profiles.length > 0
          ? profiles.map((profile) => (
              <ProfileRow
                profile={profile}
                compatibility={compatibilityById.get(profile.profileId)}
                key={profile.profileId}
              />
            ))
          : <div className="empty-row">{emptyText}</div>}
      </div>
    </section>
  );
}

export function BotProfilesPage() {
  const botProfiles = useConfigStore((state) => state.botProfiles);
  const gameProfiles = useConfigStore((state) => state.gameProfiles);
  const addBotProfilesToSession = useConfigStore((state) => state.addBotProfilesToSession);
  const openBotProfileEditor = useConfigStore((state) => state.openBotProfileEditor);
  const [specializedFilter, setSpecializedFilter] = useState<SpecializedFilter>('all');
  const [compatibilityGameId, setCompatibilityGameId] = useState(gameProfiles[0]?.gameId ?? '');
  const compatibilityGameProfile = gameProfiles.find((profile) => profile.gameId === compatibilityGameId) ?? gameProfiles[0];
  const compatibilityResults = useMemo(
    () => compatibilityGameProfile
      ? botCompatibilityEvaluator.evaluateAll(botProfiles, compatibilityGameProfile)
      : [],
    [botProfiles, compatibilityGameProfile]
  );
  const compatibilityById = useMemo(
    () => new Map(compatibilityResults.map((result) => [result.profileId, result])),
    [compatibilityResults]
  );
  const recommendedSpecialists = useMemo(
    () => botProfiles.filter(
      (profile) =>
        profile.profileGroup === 'specialized' &&
        compatibilityById.get(profile.profileId)?.status === 'recommended'
    ),
    [botProfiles, compatibilityById]
  );
  const generalProfiles = useMemo(
    () => botProfiles.filter((profile) => profile.profileGroup === 'general'),
    [botProfiles]
  );
  const specializedProfiles = useMemo(
    () => botProfiles.filter(
      (profile) =>
        profile.profileGroup === 'specialized' &&
        (specializedFilter === 'all' || profile.specializationCategory === specializedFilter)
    ),
    [botProfiles, specializedFilter]
  );
  const customProfiles = useMemo(
    () => botProfiles.filter((profile) => (profile.profileGroup ?? 'custom') === 'custom'),
    [botProfiles]
  );

  return (
    <section className="page-stack bot-profiles-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Profiles</p>
          <h1>Bot Profiles</h1>
        </div>
        <div className="page-actions">
          <button className="primary-button" type="button" onClick={() => openBotProfileEditor()}>
            <Plus size={16} aria-hidden="true" />
            <span>New Custom Profile</span>
          </button>
        </div>
      </div>

      <label className="field bot-profile-filter">
        <FieldLabel
          label="Compatibility Game Profile"
          htmlFor="bot-profile-compatibility-game"
          helpText="This is the game profile used to check whether each bot can really perform its test. The app checks controls, adapter features, screenshots, and readable game signals. For example, choose your controller game before adding the Controller Tester. If the wrong game is selected, the warnings may not match your test. Beginners should choose the game they plan to test next."
        />
        <select
          id="bot-profile-compatibility-game"
          value={compatibilityGameProfile?.gameId ?? ''}
          onChange={(event) => setCompatibilityGameId(event.target.value)}
        >
          {gameProfiles.length > 0
            ? gameProfiles.map((profile) => <option value={profile.gameId} key={profile.gameId}>{profile.gameName} {profile.version}</option>)
            : <option value="">No game profiles available</option>}
        </select>
      </label>

      <div className="bot-recommendation-summary">
        <div>
          <FieldLabel
            label="Recommended Specialist Bots"
            helpText="This is the number of specialist bots with a strong match for the selected game profile. The evaluator uses game features and adapter capabilities, not just the game engine name. For example, a game with recipes may recommend Crafting Tester. Nothing is enabled automatically. Beginners should review the list before using the add button."
          />
          <strong>{recommendedSpecialists.length} strong match{recommendedSpecialists.length === 1 ? '' : 'es'}</strong>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={recommendedSpecialists.length === 0}
          onClick={() => addBotProfilesToSession(
            recommendedSpecialists.map((profile) => profile.profileId)
          )}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Add Recommended Bots To Session</span>
        </button>
      </div>

      <ProfileSection
        title="General-Purpose Bots"
        description="Flexible profiles for broad first tests, exploration, progression, and varied player behavior."
        profiles={generalProfiles}
        emptyText="No general-purpose bot profiles are available."
        compatibilityById={compatibilityById}
      />

      <section className="bot-profile-section" aria-labelledby="specialized-bot-profiles">
        <div className="section-heading">
          <div>
            <h2 id="specialized-bot-profiles">Specialized Test Bots</h2>
            <p>Focused profiles for testing one game system or risk area in greater depth.</p>
          </div>
          <span className="status-pill">{specializedProfiles.length} visible</span>
        </div>
        <label className="field bot-profile-filter">
          <FieldLabel
            label="Specialized Category"
            htmlFor="specialized-bot-category"
            helpText="This filter shows specialized bots for one kind of testing. For example, choose UI And Input to find menu and control testers. It does not change or delete profiles. If you cannot find a bot, choose All Specialized Bots. Beginners should leave it on All first."
          />
          <select
            id="specialized-bot-category"
            value={specializedFilter}
            onChange={(event) => setSpecializedFilter(event.target.value as SpecializedFilter)}
          >
            {categoryOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="bot-profile-list">
          {specializedProfiles.length > 0
            ? specializedProfiles.map((profile) => (
                <ProfileRow
                  profile={profile}
                  compatibility={compatibilityById.get(profile.profileId)}
                  key={profile.profileId}
                />
              ))
            : <div className="empty-row">No specialized bots match this category.</div>}
        </div>
      </section>

      <ProfileSection
        title="Custom Bot Profiles"
        description="Profiles created for your own game, adapter, or studio testing rules stay separate here."
        profiles={customProfiles}
        emptyText="No custom bot profiles have been added yet."
        compatibilityById={compatibilityById}
      />
    </section>
  );
}
