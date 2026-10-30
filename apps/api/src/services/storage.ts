import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { idSchema } from '@bnature/contracts';

// Files live at <root>/<organization uuid>/<storage uuid>; no path segment comes from user input.
export interface DocumentStorage {
  write(organizationId: string, key: string, bytes: Buffer): Promise<void>;
  read(organizationId: string, key: string): Promise<Buffer>;
  remove(organizationId: string, key: string): Promise<void>;
}
export function documentStorage(root: string): DocumentStorage {
  const base = resolve(root);
  const pathFor = (organizationId: string, key: string) =>
    join(base, idSchema.parse(organizationId), idSchema.parse(key));
  return {
    async write(organizationId: string, key: string, bytes: Buffer) {
      const target = pathFor(organizationId, key),
        temporary = `${target}.partial`;
      await mkdir(join(base, organizationId), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    },
    read(organizationId: string, key: string) {
      return readFile(pathFor(organizationId, key));
    },
    async remove(organizationId: string, key: string) {
      await unlink(pathFor(organizationId, key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  };
}
