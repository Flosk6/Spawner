import type { Scope } from '../types';

/** What each scope of a token allows, as the forms explain it. */
export const SCOPE_LABELS: Record<Scope, string> = {
  'envs:read': 'Read environments, their logs and resources',
  'envs:write': 'Create, update, share and delete your environments',
  'envs:exec': 'Run commands and open terminals in your environments',
  preview: 'Open protected previews',
  admin: 'Projects, team, settings and audit',
};

export const MEMBER_SCOPES: Scope[] = ['envs:read', 'envs:write', 'envs:exec', 'preview'];
