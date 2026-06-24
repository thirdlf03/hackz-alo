export const REPLAY_VISIBILITY_VALUES = [
  'private',
  'unlisted',
  'public',
] as const;

export type ReplayVisibility = (typeof REPLAY_VISIBILITY_VALUES)[number];
