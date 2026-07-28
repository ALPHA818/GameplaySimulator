import {
  CustomBotProfileSchema,
  type BotProfile,
  type CustomBotProfile
} from '../types';

export interface CustomBotProfileValidationMessage {
  path: string;
  message: string;
}

export interface CustomBotProfileValidationResult {
  valid: boolean;
  profile?: CustomBotProfile;
  errors: CustomBotProfileValidationMessage[];
  warnings: CustomBotProfileValidationMessage[];
}

export function validateCustomBotProfile(
  candidate: unknown,
  existingProfiles: BotProfile[],
  editingProfileId?: string | null
): CustomBotProfileValidationResult {
  const parsed = CustomBotProfileSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'profile',
        message: issue.message
      })),
      warnings: []
    };
  }

  const duplicate = existingProfiles.some(
    (profile) =>
      profile.profileId === parsed.data.profileId &&
      profile.profileId !== editingProfileId
  );
  if (duplicate) {
    return {
      valid: false,
      errors: [{ path: 'profileId', message: 'Profile ID must be unique.' }],
      warnings: []
    };
  }

  return {
    valid: true,
    profile: parsed.data,
    errors: [],
    warnings: parsed.data.preferredActions.length === 0
      ? [{
          path: 'preferredActions',
          message: 'This profile has no preferred actions and may behave like a general bot.'
        }]
      : []
  };
}
