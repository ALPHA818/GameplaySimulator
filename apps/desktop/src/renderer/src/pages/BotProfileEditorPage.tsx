import {
  BotCapabilityIdSchema,
  BotSpecializationCategorySchema,
  IssueCategorySchema,
  type BotCapabilityId,
  type BotProfile,
  type BotSpecializationCategory,
  type CustomBotProfile,
  type IssueCategory,
  type ResourceWeight
} from '@core/types';
import { validateCustomBotProfile } from '@core/bot/CustomBotProfileValidator';
import { Copy, Save, X } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  FieldLabel,
  SelectInput,
  TextareaInput,
  TextInput
} from '../components/FormFields';
import { useConfigStore } from '../store/configStore';
import type { FieldErrors } from '../utils/forms';

interface BotProfileFormState {
  profileId: string;
  displayName: string;
  profileGroup: 'custom';
  specializationCategory: BotSpecializationCategory;
  description: string;
  preferredActions: string;
  avoidedActions: string;
  targetScenes: string;
  targetFeatures: string;
  targetIssueCategories: IssueCategory[];
  aggression: number;
  curiosity: number;
  riskTolerance: number;
  repetitionTolerance: number;
  bugHuntingBias: number;
  requiredCapabilities: BotCapabilityId[];
  recommendedGameTypes: string[];
  resourceWeight: ResourceWeight;
  recommendedMinCount: string;
  recommendedMaxCount: string;
  limitations: string;
  successCriteria: string;
}

const gameTypeOptions = [
  'desktop',
  'browser',
  'instrumented',
  'unity',
  'godot',
  'unreal',
  'custom'
];

const capabilityLabels: Record<string, string> = {
  'state-read': 'State read',
  'direct-actions': 'Direct actions',
  'input-simulation': 'Input simulation',
  screenshots: 'Screenshots',
  video: 'Video',
  'game-logs': 'Game logs',
  'save-isolation': 'Save isolation',
  reset: 'Reset',
  'checkpoint-reload': 'Checkpoint reload',
  'multiple-instances': 'Multiple instances',
  'live-observation': 'Live observation',
  'window-focus': 'Window focus',
  'keyboard-input': 'Keyboard input',
  'mouse-input': 'Mouse input',
  'gamepad-input': 'Gamepad input',
  'touch-input': 'Touch input',
  'ui-flows': 'UI flows',
  'performance-metrics': 'Performance metrics',
  'network-instrumentation': 'Network instrumentation',
  'audio-signals': 'Audio signals',
  'file-test-sandbox': 'File-test sandbox'
};

function listValue(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function lines(values: string[] | undefined): string {
  return values?.join('\n') ?? '';
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueCloneId(source: BotProfile, profiles: BotProfile[]): string {
  const base = `${slug(source.displayName) || source.profileId}-copy`;
  let candidate = base;
  let copyIndex = 2;

  while (profiles.some((profile) => profile.profileId === candidate)) {
    candidate = `${base}-${copyIndex}`;
    copyIndex += 1;
  }

  return candidate;
}

function emptyForm(): BotProfileFormState {
  return {
    profileId: '',
    displayName: '',
    profileGroup: 'custom',
    specializationCategory: 'gameplay-systems',
    description: '',
    preferredActions: '',
    avoidedActions: '',
    targetScenes: '',
    targetFeatures: '',
    targetIssueCategories: [],
    aggression: 0.3,
    curiosity: 0.7,
    riskTolerance: 0.5,
    repetitionTolerance: 0.7,
    bugHuntingBias: 0.8,
    requiredCapabilities: [],
    recommendedGameTypes: [],
    resourceWeight: 'medium',
    recommendedMinCount: '1',
    recommendedMaxCount: '3',
    limitations: '',
    successCriteria: ''
  };
}

function formFromProfile(
  profile: BotProfile,
  profiles: BotProfile[],
  cloning: boolean
): BotProfileFormState {
  const knownCapabilities = new Set<string>(BotCapabilityIdSchema.options);
  const issueCategories = profile.targetIssueCategories ??
    [...new Set(profile.goals.flatMap((goal) => goal.targetIssueCategories))];
  const successCriteria = profile.successCriteria ??
    profile.goals.flatMap((goal) => goal.successCriteria);

  return {
    profileId: cloning ? uniqueCloneId(profile, profiles) : profile.profileId,
    displayName: cloning ? `${profile.displayName} Copy` : profile.displayName,
    profileGroup: 'custom',
    specializationCategory: profile.specializationCategory ?? 'gameplay-systems',
    description: profile.description ?? profile.bestUsedFor?.join('\n') ?? '',
    preferredActions: lines(profile.preferredActions),
    avoidedActions: lines(profile.avoidedActions),
    targetScenes: lines(profile.targetScenes),
    targetFeatures: lines(profile.targetFeatures ?? profile.tags),
    targetIssueCategories: issueCategories,
    aggression: profile.aggression ?? 0.3,
    curiosity: profile.curiosity ?? 0.7,
    riskTolerance: profile.riskTolerance ?? 0.5,
    repetitionTolerance: profile.repetitionTolerance ?? 0.7,
    bugHuntingBias: profile.bugHuntingBias ?? 0.8,
    requiredCapabilities: (profile.requiredCapabilities ?? [])
      .filter((capability): capability is BotCapabilityId => knownCapabilities.has(capability)),
    recommendedGameTypes: profile.recommendedGameTypes ?? [],
    resourceWeight: profile.defaultResourceWeight,
    recommendedMinCount: String(profile.recommendedMinCount),
    recommendedMaxCount: String(profile.recommendedMaxCount),
    limitations: lines(profile.limitations),
    successCriteria: lines(successCriteria)
  };
}

function selectedValues(event: ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.currentTarget.selectedOptions, (option) => option.value);
}

function withoutErrors(errors: FieldErrors, keys: string[]): FieldErrors {
  const next = { ...errors };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function TraitField({
  label,
  helpText,
  value,
  onChange
}: {
  label: string;
  helpText: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field trait-field">
      <FieldLabel label={label} helpText={helpText} />
      <div className="trait-field__control">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
        <output>{value.toFixed(2)}</output>
      </div>
    </label>
  );
}

export function BotProfileEditorPage() {
  const botProfiles = useConfigStore((state) => state.botProfiles);
  const editingBotProfileId = useConfigStore((state) => state.editingBotProfileId);
  const cloningBotProfileId = useConfigStore((state) => state.cloningBotProfileId);
  const saveBotProfile = useConfigStore((state) => state.saveBotProfile);
  const navigate = useConfigStore((state) => state.navigate);
  const editingProfile = botProfiles.find((profile) => profile.profileId === editingBotProfileId);
  const cloningProfile = botProfiles.find((profile) => profile.profileId === cloningBotProfileId);
  const [cloneSourceId, setCloneSourceId] = useState(cloningBotProfileId ?? botProfiles[0]?.profileId ?? '');
  const [profileIdTouched, setProfileIdTouched] = useState(Boolean(editingProfile || cloningProfile));
  const [form, setForm] = useState<BotProfileFormState>(() =>
    editingProfile
      ? formFromProfile(editingProfile, botProfiles, false)
      : cloningProfile
        ? formFromProfile(cloningProfile, botProfiles, true)
        : emptyForm()
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [warning, setWarning] = useState<string | null>(null);
  const [allowEmptyPreferredActions, setAllowEmptyPreferredActions] = useState(false);

  function update<K extends keyof BotProfileFormState>(key: K, value: BotProfileFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => withoutErrors(current, [key]));
    if (key === 'preferredActions') {
      setAllowEmptyPreferredActions(false);
      setWarning(null);
    }
  }

  function updateName(displayName: string) {
    setForm((current) => ({
      ...current,
      displayName,
      profileId: profileIdTouched ? current.profileId : slug(displayName)
    }));
    setErrors((current) => withoutErrors(current, ['displayName', 'profileId']));
  }

  function cloneSelectedProfile() {
    const source = botProfiles.find((profile) => profile.profileId === cloneSourceId);
    if (!source) return;
    setForm(formFromProfile(source, botProfiles, true));
    setProfileIdTouched(true);
    setErrors({});
    setAllowEmptyPreferredActions(false);
    setWarning(
      'The clone is a new custom profile. Review its known capability IDs because descriptive built-in requirements are not copied as capability selections.'
    );
  }

  function buildProfile(): CustomBotProfile {
    const targetIssueCategories = form.targetIssueCategories;
    const successCriteria = listValue(form.successCriteria);
    const profileId = form.profileId.trim();

    return {
      profileId,
      displayName: form.displayName.trim(),
      botType: profileId,
      profileGroup: 'custom',
      specializationCategory: form.specializationCategory,
      requiredCapabilities: form.requiredCapabilities,
      recommendedGameTypes: form.recommendedGameTypes,
      incompatibleGameTypes: [],
      bestUsedFor: [form.description.trim()].filter(Boolean),
      limitations: listValue(form.limitations),
      beginnerRecommended: false,
      beginnerExplanation: 'Start with one bot and confirm that the selected game adapter exposes this custom profile\'s preferred actions.',
      defaultEnabled: false,
      estimatedComplexity: 'medium',
      playstyle: `custom-${form.specializationCategory}`,
      description: form.description.trim(),
      aggression: form.aggression,
      curiosity: form.curiosity,
      riskTolerance: form.riskTolerance,
      repetitionTolerance: form.repetitionTolerance,
      bugHuntingBias: form.bugHuntingBias,
      preferredActions: listValue(form.preferredActions),
      avoidedActions: listValue(form.avoidedActions),
      targetScenes: listValue(form.targetScenes),
      targetFeatures: listValue(form.targetFeatures),
      targetIssueCategories,
      successCriteria,
      goals: [{
        goalId: `${profileId || 'custom-profile'}-goal`,
        name: `${form.displayName.trim() || 'Custom profile'} Test Goal`,
        description: form.description.trim(),
        priority: 10,
        successCriteria,
        targetIssueCategories
      }],
      recommendedMinCount: Number(form.recommendedMinCount),
      recommendedMaxCount: Number(form.recommendedMaxCount),
      defaultResourceWeight: form.resourceWeight,
      tags: listValue(form.targetFeatures),
      config: { customProfile: true }
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = buildProfile();
    const validation = validateCustomBotProfile(
      candidate,
      botProfiles,
      editingBotProfileId
    );

    if (!validation.valid || !validation.profile) {
      setErrors(Object.fromEntries(
        validation.errors.map((error) => [error.path, error.message])
      ));
      setWarning(null);
      return;
    }

    if (validation.warnings.length > 0 && !allowEmptyPreferredActions) {
      setErrors({});
      setWarning(
        `${validation.warnings[0].message} Click Save Profile again to save it anyway.`
      );
      setAllowEmptyPreferredActions(true);
      return;
    }

    setErrors({});
    setWarning(null);
    saveBotProfile(validation.profile);
  }

  return (
    <section className="page-stack bot-profile-editor-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Custom Specialist</p>
          <h1>{editingProfile ? 'Edit Bot Profile' : 'New Bot Profile'}</h1>
        </div>
      </div>

      <section className="form-section">
        <div className="section-heading">
          <div>
            <h2>Clone Existing Profile</h2>
          </div>
        </div>
        <div className="profile-clone-row">
          <SelectInput
            label="Clone Existing Profile"
            helpText="This chooses an existing bot as a starting point. The editor copies its behavior values and actions into a new custom profile. For example, clone Crafting Tester before making a Material Combination Tester. The original profile is never changed. Beginners should clone the closest existing tester."
            value={cloneSourceId}
            onChange={(event) => setCloneSourceId(event.target.value)}
          >
            {botProfiles.map((profile) => (
              <option value={profile.profileId} key={profile.profileId}>{profile.displayName}</option>
            ))}
          </SelectInput>
          <button className="secondary-button" type="button" onClick={cloneSelectedProfile}>
            <Copy size={16} aria-hidden="true" />
            <span>Clone Profile</span>
          </button>
        </div>
      </section>

      <form className="form-grid" onSubmit={submit} noValidate>
        <section className="form-section">
          <div className="section-heading">
            <div>
              <h2>Profile Identity</h2>
            </div>
          </div>
          <div className="profile-editor-grid">
            <TextInput
              label="Profile Name"
              helpText="This is the name shown in Bot Profiles and New Session. For example, Hexcraft Material Combination Tester. The simulator uses it in live status and reports. If it is unclear, users may choose the wrong bot. Beginners should name the exact feature being tested."
              value={form.displayName}
              error={errors.displayName}
              onChange={(event) => updateName(event.target.value)}
            />
            <TextInput
              label="Profile ID"
              helpText="This is the unique short ID stored in session configs and reports. The editor creates it from the profile name, but you can change it. For example, hexcraft-material-combination-tester. If another profile uses the same ID, this profile cannot be saved. Beginners should keep the generated ID."
              value={form.profileId}
              error={errors.profileId}
              onChange={(event) => {
                setProfileIdTouched(true);
                update('profileId', slug(event.target.value));
              }}
            />
            <SelectInput
              label="Profile Group"
              helpText="This decides which Bot Profiles section contains the profile. User-made specialists are kept in Custom Bot Profiles so they do not get mixed with built-in bots. The simulator uses Custom for every profile created here. Beginners should leave this on Custom."
              value={form.profileGroup}
              disabled
              onChange={() => undefined}
            >
              <option value="custom">Custom</option>
            </SelectInput>
            <SelectInput
              label="Specialization Category"
              helpText="This groups the custom bot by the system it tests. For example, a Farming System Tester fits Gameplay Systems, while a Save Migration bot fits Saves And Persistence. The category helps users filter profiles. If it is wrong, the bot still works but is harder to find."
              value={form.specializationCategory}
              error={errors.specializationCategory}
              onChange={(event) =>
                update('specializationCategory', event.target.value as BotSpecializationCategory)
              }
            >
              {BotSpecializationCategorySchema.options.map((category) => (
                <option value={category} key={category}>{category.replaceAll('-', ' ')}</option>
              ))}
            </SelectInput>
            <TextareaInput
              className="field--wide"
              label="What This Bot Tests"
              helpText="Describe the unique game feature this bot should focus on. The description appears in the catalog and reports. For example, combine Hexcraft materials in valid and invalid patterns and check every result. If it is vague, users may not know whether the bot fits their test. Beginners should describe one focused system."
              rows={4}
              value={form.description}
              error={errors.description}
              onChange={(event) => update('description', event.target.value)}
            />
          </div>
        </section>

        <section className="form-section">
          <div className="section-heading">
            <div>
              <h2>Targets And Actions</h2>
            </div>
          </div>
          <div className="profile-editor-grid">
            <TextareaInput
              label="Preferred Actions"
              helpText="These are adapter-reported actions the bot should favor. Enter one action per line, such as combine-materials or inspect-result. The planner never invents actions that the game does not report. If this is empty, the profile can be saved but receives a warning. Beginners should add three to six real action names."
              rows={5}
              value={form.preferredActions}
              onChange={(event) => update('preferredActions', event.target.value)}
            />
            <TextareaInput
              label="Avoided Actions"
              helpText="These are actions the bot should avoid when other choices exist. Enter one action per line. For example, leave-crafting-area or delete-save. This lowers planner scores but does not override safety or recovery. If an important action is listed by mistake, the bot may make less progress."
              rows={5}
              value={form.avoidedActions}
              onChange={(event) => update('avoidedActions', event.target.value)}
            />
            <TextareaInput
              label="Target Scenes"
              helpText="These are scenes, levels, or areas where this bot is most useful. Enter one name per line. For example, Workshop, Farm, or Vehicle Garage. The simulator records these targets for planning and reports. Wrong names may never match game state. Beginners can leave this empty when the feature works everywhere."
              rows={4}
              value={form.targetScenes}
              onChange={(event) => update('targetScenes', event.target.value)}
            />
            <TextareaInput
              label="Target Features"
              helpText="These are short feature names that describe the system under test. Enter one per line, such as farming, crop-growth, or spell-combination. The compatibility evaluator uses them as profile metadata. If they are too broad, recommendations may be less useful. Beginners should use two or three exact feature names."
              rows={4}
              value={form.targetFeatures}
              onChange={(event) => update('targetFeatures', event.target.value)}
            />
            <SelectInput
              className="field--wide"
              label="Target Issue Categories"
              helpText="These are the kinds of problems this bot should look for. Hold Ctrl or Command to choose several. For example, choose gameplay, inventory, and exploit for a material combination tester. Only supported categories are listed, so unknown values cannot be saved. Beginners should choose the two or three closest categories."
              multiple
              size={8}
              value={form.targetIssueCategories}
              error={errors.targetIssueCategories}
              onChange={(event) =>
                update('targetIssueCategories', selectedValues(event) as IssueCategory[])
              }
            >
              {IssueCategorySchema.options.map((category) => (
                <option value={category} key={category}>{category.replaceAll('_', ' ')}</option>
              ))}
            </SelectInput>
            <TextareaInput
              className="field--wide"
              label="Success Criteria"
              helpText="These are clear results that show the test worked. Enter one result per line. For example, every valid material pair creates the expected item and no input item disappears. Reports use these goals to explain the profile. If they cannot be measured, a person may need to review the result."
              rows={5}
              value={form.successCriteria}
              onChange={(event) => update('successCriteria', event.target.value)}
            />
          </div>
        </section>

        <section className="form-section">
          <div className="section-heading">
            <div>
              <h2>Behavior</h2>
            </div>
          </div>
          <div className="profile-trait-grid">
            <TraitField
              label="Aggression"
              helpText="This controls how strongly the bot favors forceful or confrontational actions. Zero is calm and one is very aggressive. For example, a combat tester may use 0.8 while a customization tester may use 0.1. A high value can create riskier behavior. Beginners should use 0.3."
              value={form.aggression}
              onChange={(value) => update('aggression', value)}
            />
            <TraitField
              label="Curiosity"
              helpText="This controls how much the bot favors unfamiliar actions and content. Zero stays predictable and one explores often. For example, a spell combination tester may use 0.8. If this is too low, unusual combinations may be missed. Beginners should use 0.7."
              value={form.curiosity}
              onChange={(value) => update('curiosity', value)}
            />
            <TraitField
              label="Risk Tolerance"
              helpText="This controls how willing the bot is to try actions that may fail or enter edge cases. Zero is cautious and one accepts high risk. For example, a vehicle upgrade tester might use 0.5. High risk can create more failures. Beginners should use 0.5."
              value={form.riskTolerance}
              onChange={(value) => update('riskTolerance', value)}
            />
            <TraitField
              label="Repetition Tolerance"
              helpText="This controls how willing the bot is to repeat similar tests. Zero avoids repeats and one can run long loops. For example, a farming growth tester may use 0.9. A high value may create more actions and longer runs. Beginners should use 0.7."
              value={form.repetitionTolerance}
              onChange={(value) => update('repetitionTolerance', value)}
            />
            <TraitField
              label="Bug Hunting Bias"
              helpText="This controls how strongly the bot favors actions likely to reveal edge cases. Zero behaves normally and one focuses heavily on bug hunting. For example, a material combination tester may use 0.9. Very high values can reduce ordinary gameplay coverage. Beginners should use 0.8."
              value={form.bugHuntingBias}
              onChange={(value) => update('bugHuntingBias', value)}
            />
          </div>
        </section>

        <section className="form-section">
          <div className="section-heading">
            <div>
              <h2>Compatibility And Limits</h2>
            </div>
          </div>
          <div className="profile-editor-grid">
            <SelectInput
              label="Required Capabilities"
              helpText="These are simulator features the bot needs from the selected adapter. Hold Ctrl or Command to choose several. For example, a spell tester may need state-read and direct-actions. Only known capability IDs are accepted. If a selected game lacks one, compatibility will be Limited or Unsupported."
              multiple
              size={8}
              value={form.requiredCapabilities}
              error={errors.requiredCapabilities}
              onChange={(event) =>
                update('requiredCapabilities', selectedValues(event) as BotCapabilityId[])
              }
            >
              {BotCapabilityIdSchema.options.map((capability) => (
                <option value={capability} key={capability}>
                  {capabilityLabels[capability] ?? capability}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Recommended Game Types"
              helpText="These are game types where this custom bot is expected to work best. Hold Ctrl or Command to choose several. For example, choose browser and instrumented for a DOM-aware customization tester. Other game types may be marked Limited. Beginners should choose only game types they can actually test."
              multiple
              size={7}
              value={form.recommendedGameTypes}
              onChange={(event) => update('recommendedGameTypes', selectedValues(event))}
            >
              {gameTypeOptions.map((gameType) => (
                <option value={gameType} key={gameType}>{gameType}</option>
              ))}
            </SelectInput>
            <SelectInput
              label="Resource Weight"
              helpText="This estimates how much CPU and RAM one bot may add. Light is small, while very heavy is for demanding loops or telemetry. The Resource Manager uses this when recommending counts. If this is too low, a session may overload the computer. Beginners should use Medium."
              value={form.resourceWeight}
              onChange={(event) => update('resourceWeight', event.target.value as ResourceWeight)}
            >
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="heavy">Heavy</option>
              <option value="very_heavy">Very heavy</option>
            </SelectInput>
            <TextInput
              label="Recommended Minimum Count"
              helpText="This is the smallest useful number of this bot. For example, one material tester is enough for a first run. New Session uses it when creating a pool. If it is too high, small computers may struggle. Beginners should use 1."
              type="number"
              min={0}
              step={1}
              value={form.recommendedMinCount}
              error={errors.recommendedMinCount}
              onChange={(event) => update('recommendedMinCount', event.target.value)}
            />
            <TextInput
              label="Recommended Maximum Count"
              helpText="This is the largest useful count for this bot profile. For example, four farming testers may cover different crops. It cannot be below the minimum count. A large number can use more CPU, RAM, and game instances. Beginners should use 3."
              type="number"
              min={1}
              step={1}
              value={form.recommendedMaxCount}
              error={errors.recommendedMaxCount}
              onChange={(event) => update('recommendedMaxCount', event.target.value)}
            />
            <TextareaInput
              className="field--wide"
              label="Limitations"
              helpText="These are things the custom bot cannot fully test or prove. Enter one limitation per line. For example, visual spell effects still need screenshot review. The catalog shows these notes before a session. If this is empty, users may trust the bot too much. Beginners should record at least one important limit."
              rows={5}
              value={form.limitations}
              onChange={(event) => update('limitations', event.target.value)}
            />
          </div>
        </section>

        {warning ? (
          <div className="notice-list notice-list--warning" aria-live="polite">
            <strong>Profile warning</strong>
            <span>{warning}</span>
          </div>
        ) : null}

        <div className="page-actions profile-editor-actions">
          <button className="primary-button" type="submit">
            <Save size={16} aria-hidden="true" />
            <span>Save Profile</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate('botProfiles')}>
            <X size={16} aria-hidden="true" />
            <span>Cancel</span>
          </button>
        </div>
      </form>
    </section>
  );
}
