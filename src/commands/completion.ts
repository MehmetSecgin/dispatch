import type { Command } from 'commander';

interface CompletionTree {
  roots: string[];
  subcommands: Record<string, string[]>;
}

interface CommandManifestEntry {
  cmd: string;
  desc: string;
}

function qList(values: readonly string[]): string {
  return values.join(' ');
}

function normalize(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function buildCompletionTree(program: Command): CompletionTree {
  const subcommands: Record<string, string[]> = {};
  const roots: string[] = [];

  for (const cmd of program.commands) {
    const name = cmd.name();
    if (!name || name === 'help') continue;
    roots.push(name);

    const children = normalize(cmd.commands.map((c) => c.name()).filter((n) => !!n && n !== 'help'));
    if (children.length > 0) subcommands[name] = children;
  }

  roots.push('help');
  return {
    roots: normalize(roots),
    subcommands,
  };
}

export function collectCommands(
  program: Command,
  opts?: { exclude?: Set<string> },
): CommandManifestEntry[] {
  const exclude = opts?.exclude ?? new Set<string>();
  return collectFrom(program.commands, [], exclude);
}

export function renderCompletion(shell: string, tree: CompletionTree): string {
  const normalized = shell.trim().toLowerCase();
  if (normalized === 'bash') return renderBash(tree);
  if (normalized === 'zsh') return renderZsh(tree);
  if (normalized === 'fish') return renderFish(tree);
  throw new Error(`Unsupported shell '${shell}'. Use bash, zsh, or fish.`);
}

function collectFrom(
  commands: readonly Command[],
  parents: string[],
  exclude: ReadonlySet<string>,
): CommandManifestEntry[] {
  const out: CommandManifestEntry[] = [];

  for (const cmd of commands) {
    const name = cmd.name();
    if (!name || exclude.has(name)) continue;

    const pathParts = [...parents, name];
    const childEntries = collectFrom(cmd.commands, pathParts, exclude);
    const requiredArgs = cmd.registeredArguments
      .filter((argument) => argument.required)
      .map((argument) => `<${argument.name()}${argument.variadic ? '...' : ''}>`);
    const requiredFlags = cmd.options
      .filter((option) => option.mandatory)
      .map((option) => option.flags);
    const hasAction = Boolean((cmd as Command & { _actionHandler?: unknown })._actionHandler);

    if (hasAction || childEntries.length === 0) {
      out.push({
        cmd: [...pathParts, ...requiredArgs, ...requiredFlags].join(' '),
        desc: cmd.description(),
      });
    }

    out.push(...childEntries);
  }

  return out;
}

function renderBash(tree: CompletionTree): string {
  const roots = qList(tree.roots);
  const cases = Object.entries(tree.subcommands)
    .map(([root, subs]) => `    ${root}) COMPREPLY=( $(compgen -W "${qList(subs)}" -- "$cur") ); return ;;`)
    .join('\n');

  return `# dispatch completion for bash\n_dispatch_complete() {\n  local cur prev\n  COMPREPLY=()\n  cur=\"\${COMP_WORDS[COMP_CWORD]}\"\n  prev=\"\${COMP_WORDS[COMP_CWORD-1]}\"\n\n  if [[ \${COMP_CWORD} -eq 1 ]]; then\n    COMPREPLY=( $(compgen -W \"${roots}\" -- \"$cur\") )\n    return\n  fi\n\n  case \"$prev\" in\n${cases}\n  esac\n}\ncomplete -F _dispatch_complete dispatch\n`;
}

function renderZsh(tree: CompletionTree): string {
  const roots = qList(tree.roots);
  const cases = Object.entries(tree.subcommands)
    .map(([root, subs]) => `    ${root}) compadd -- ${qList(subs)}; return ;;`)
    .join('\n');

  return `# dispatch completion for zsh\n_dispatch_complete() {\n  local curcontext=\"$curcontext\" state line\n  typeset -A opt_args\n\n  if (( CURRENT == 2 )); then\n    compadd -- ${roots}\n    return\n  fi\n\n  case \"$words[2]\" in\n${cases}\n  esac\n}\ncompdef _dispatch_complete dispatch\n`;
}

function renderFish(tree: CompletionTree): string {
  const lines: string[] = ['# dispatch completion for fish', 'complete -c dispatch -f'];
  for (const root of tree.roots) {
    lines.push(`complete -c dispatch -f -n '__fish_use_subcommand' -a '${root}'`);
  }
  for (const [root, subs] of Object.entries(tree.subcommands)) {
    for (const sub of subs) {
      lines.push(`complete -c dispatch -f -n '__fish_seen_subcommand_from ${root}' -a '${sub}'`);
    }
  }
  return `${lines.join('\n')}\n`;
}
