/**
 * A Dockerfile that copies the whole code before installing dependencies:
 * any change to the code then invalidates the layer that installs them, so
 * every environment builds and stores its own copy instead of sharing one.
 */
export interface LayerOrderWarning {
  /** Line of the instruction that copies the whole code. */
  copyLine: number;
  /** Line of the instruction that installs the dependencies after it. */
  installLine: number;
  message: string;
  hint: string;
}

const INSTALL_COMMANDS = [
  /\bnpm\s+(ci|install|i)\b/,
  /\bpnpm\s+(install|i)\b/,
  /\byarn(\s+install)?\s*(--[\w-]+\s*)*($|&&|;|\|)/,
  /\bbun\s+install\b/,
  /\bcomposer\s+install\b/,
  /\bpip3?\s+install\s+(.*\s)?-r\b/,
  /\b(poetry|pipenv)\s+install\b/,
  /\buv\s+sync\b/,
  /\bbundle\s+install\b/,
  /\bgo\s+mod\s+download\b/,
];

/**
 * Instructions of a Dockerfile, continuation lines joined, comments and
 * blank lines left out, each with the line it starts on.
 */
function instructions(text: string): { line: number; keyword: string; args: string }[] {
  const result: { line: number; keyword: string; args: string }[] = [];
  let current: { line: number; text: string } | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!current && (trimmed === '' || trimmed.startsWith('#'))) {
      return;
    }
    if (current && trimmed.startsWith('#')) {
      return;
    }
    const continued = trimmed.endsWith('\\');
    const part = continued ? trimmed.slice(0, -1) : trimmed;
    current = current ? { line: current.line, text: `${current.text} ${part}` } : { line: index + 1, text: part };
    if (!continued) {
      const match = /^(\w+)\s*(.*)$/s.exec(current.text.trim());
      if (match) {
        result.push({ line: current.line, keyword: match[1].toUpperCase(), args: match[2] });
      }
      current = null;
    }
  });
  return result;
}

/**
 * Whether a COPY or ADD takes the whole build context: "COPY . .",
 * "COPY --chown=node:node . /app", "ADD ./ /srv".
 */
function copiesEverything(args: string): boolean {
  const words = args.split(/\s+/).filter((word) => word.length > 0);
  if (words.some((word) => word.startsWith('--from'))) {
    return false;
  }
  const paths = words.filter((word) => !word.startsWith('--'));
  if (paths.length < 2) {
    return false;
  }
  return paths.slice(0, -1).some((source) => ['.', './', './.', '*', './*'].includes(source));
}

/**
 * Finds, stage by stage, a copy of the whole code followed by an
 * installation of dependencies.
 *
 * @param text - Content of the Dockerfile
 * @returns At most one warning per stage
 */
export function dockerfileLayerWarnings(text: string): LayerOrderWarning[] {
  const warnings: LayerOrderWarning[] = [];
  let copyLine: number | null = null;
  let warned = false;
  for (const instruction of instructions(text)) {
    if (instruction.keyword === 'FROM') {
      copyLine = null;
      warned = false;
    } else if ((instruction.keyword === 'COPY' || instruction.keyword === 'ADD') && copyLine === null && copiesEverything(instruction.args)) {
      copyLine = instruction.line;
    } else if (instruction.keyword === 'RUN' && copyLine !== null && !warned && INSTALL_COMMANDS.some((pattern) => pattern.test(instruction.args))) {
      warned = true;
      warnings.push({
        copyLine,
        installLine: instruction.line,
        message: `the whole code is copied (line ${copyLine}) before the dependencies are installed (line ${instruction.line}): every environment builds and stores its own copy of them`,
        hint: 'copy the dependency files first (package.json and its lockfile, composer.json, requirements.txt...), install, then copy the code: environments then share the dependency layer',
      });
    }
  }
  return warnings;
}
