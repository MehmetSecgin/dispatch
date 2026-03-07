import { ActionConflict, ModuleDefinition, ResolvedAction } from './types.js';

export class ModuleRegistry {
  private readonly modules: ModuleDefinition[] = [];
  private readonly actions = new Map<string, ResolvedAction>();
  private readonly conflicts: ActionConflict[] = [];

  register(mod: ModuleDefinition): void {
    this.modules.push(mod);
    for (const [actionName, action] of Object.entries(mod.actions)) {
      const actionKey = `${mod.name}.${actionName}`;
      const existing = this.actions.get(actionKey);
      const next: ResolvedAction = {
        actionKey,
        moduleName: mod.name,
        actionName,
        layer: mod.layer,
        version: mod.version,
        sourcePath: mod.sourcePath,
        definition: action,
      };
      if (existing) {
        this.conflicts.push({
          actionKey,
          previous: {
            moduleName: existing.moduleName,
            layer: existing.layer,
            version: existing.version,
            sourcePath: existing.sourcePath,
          },
          winner: {
            moduleName: next.moduleName,
            layer: next.layer,
            version: next.version,
            sourcePath: next.sourcePath,
          },
        });
      }
      this.actions.set(actionKey, next);
    }
  }

  resolve(actionKey: string): ResolvedAction | null {
    return this.actions.get(actionKey) ?? null;
  }

  listModules(): ModuleDefinition[] {
    return [...this.modules];
  }

  listActions(): ResolvedAction[] {
    return [...this.actions.values()].sort((a, b) => a.actionKey.localeCompare(b.actionKey));
  }

  listConflicts(): ActionConflict[] {
    return [...this.conflicts];
  }
}
