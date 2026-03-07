import { ActionConflict, ResolvedAction } from './types.js';

export function conflictMessage(conflict: ActionConflict): string {
  return [
    `action '${conflict.actionKey}' overridden`,
    `winner=${conflict.winner.moduleName}@${conflict.winner.version}(${conflict.winner.layer})`,
    `replaced=${conflict.previous.moduleName}@${conflict.previous.version}(${conflict.previous.layer})`,
  ].join(' ');
}

export function buildResolutionRow(stepId: string, stepAction: string, resolved: ResolvedAction | null) {
  if (!resolved) {
    return {
      stepId,
      stepAction,
      resolved: null,
    };
  }
  return {
    stepId,
    stepAction,
    resolved: {
      actionKey: resolved.actionKey,
      moduleName: resolved.moduleName,
      actionName: resolved.actionName,
      layer: resolved.layer,
      version: resolved.version,
      sourcePath: resolved.sourcePath,
    },
  };
}
