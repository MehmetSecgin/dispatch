import { ModuleDefinition } from '../internal-types.js';
import { createFlowModule } from './flow/index.js';
import { createMemoryModule } from './memory/index.js';

export function loadBuiltinModules(): ModuleDefinition[] {
  return [
    createFlowModule('builtin:flow'),
    createMemoryModule('builtin:memory'),
  ];
}
