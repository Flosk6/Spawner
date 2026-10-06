/**
 * Hostname of an exposure. The entrypoint gets the short form
 * "<env>--<project>.<domain>", the others "<exposure>--<env>--<project>.<domain>".
 * A single subdomain level keeps every host under one wildcard certificate.
 */
export function exposureHostname(params: {
  project: string;
  env: string;
  exposure: string;
  entrypoint: boolean;
  domain: string;
}): string {
  const label = params.entrypoint
    ? `${params.env}--${params.project}`
    : `${params.exposure}--${params.env}--${params.project}`;
  return `${label}.${params.domain}`;
}

/**
 * Turns an exposure or source name into the suffix of its variable:
 * "front-end" becomes "FRONT_END" in SPAWNER_URL_FRONT_END.
 */
export function variableSuffix(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}
