export type IssueCode =
  | 'yaml.invalid'
  | 'yaml.too_large'
  | 'manifest.invalid'
  | 'manifest.public_exposure'
  | 'manifest.always_on'
  | 'manifest.source_repo'
  | 'slug.invalid'
  | 'variables.invalid'
  | 'interpolation.invalid'
  | 'interpolation.unknown_variable'
  | 'interpolation.required_variable'
  | 'compose.invalid'
  | 'compose.forbidden_key'
  | 'compose.unknown_key'
  | 'compose.path_outside_sources'
  | 'compose.path_not_found'
  | 'compose.undefined_reference'
  | 'compose.limit_exceeded'
  | 'compose.not_exposable';

/**
 * A problem found while validating a manifest or a compose file. The path
 * points at the offending key (for example "services.api.ports") so that a
 * human or an agent can fix it without guessing.
 */
export interface Issue {
  code: IssueCode;
  path: string;
  message: string;
  hint?: string;
}

/**
 * Formats an issue on a single line: "path: message (hint)".
 */
export function formatIssue(issue: Issue): string {
  const hint = issue.hint ? ` (${issue.hint})` : '';
  return `${issue.path || '<root>'}: ${issue.message}${hint}`;
}

/**
 * Thrown when a manifest or a compose file is rejected. Carries every issue
 * found, not only the first one.
 */
export class ValidationError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map(formatIssue).join('\n'));
    this.name = 'ValidationError';
  }
}
