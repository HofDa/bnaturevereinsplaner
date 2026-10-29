import Dexie, { type EntityTable } from 'dexie';
// Phase 1 stores only non-personal shell metadata. No membership or session store.
export class ShellDatabase extends Dexie {
  metadata!: EntityTable<{ key: string; value: string }, 'key'>;
  constructor() {
    super('bnature-shell');
    this.version(1).stores({ metadata: 'key' });
  }
}
export const shellDatabase = new ShellDatabase();
