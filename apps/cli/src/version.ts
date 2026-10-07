declare const __SPAWNER_CLI_VERSION__: string | undefined;

/** Version of the CLI, set when bundling ("dev" when run from the sources). */
export const VERSION = typeof __SPAWNER_CLI_VERSION__ === "string" ? __SPAWNER_CLI_VERSION__ : "dev";
