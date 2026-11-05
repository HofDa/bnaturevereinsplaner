import Dexie, { type EntityTable } from 'dexie';
import type {
  AttendanceSnapshot,
  AttendanceOperation,
  AttendanceResult,
  Me,
  AttendanceRecord,
} from '@bnature/contracts';
import { api, ApiError } from './api';

type Cipher = { iv: ArrayBuffer; cipher: ArrayBuffer };
type Copy = { id: string; userId: string; organizationId: string; expiresAt: string; data: Cipher };
export type QueuedAttendance = AttendanceOperation & {
  syncStatus: 'pending' | 'conflict' | 'error' | 'auth_required';
  error?: string;
  serverRecord?: Pick<
    AttendanceRecord,
    'status' | 'version' | 'checkedInAt' | 'registrationStatus'
  >;
};
type Queued = {
  id: string;
  userId: string;
  organizationId: string;
  eventOccurrenceId: string;
  registrationId: string;
  createdAt: string;
  data: Cipher;
};
class AttendanceDatabase extends Dexie {
  copies!: EntityTable<Copy, 'id'>;
  outbox!: EntityTable<Queued, 'id'>;
  keys!: EntityTable<{ id: string; key: CryptoKey }, 'id'>;
  context!: EntityTable<{ id: string; userId: string; organizationId: string }, 'id'>;
  constructor() {
    super('bnature-attendance');
    this.version(1).stores({
      copies: 'id,userId,organizationId,expiresAt',
      outbox: 'id,userId,organizationId,eventOccurrenceId,registrationId,createdAt',
      keys: 'id',
      context: 'id',
    });
  }
}
export const attendanceDatabase = new AttendanceDatabase();
let generation = 0;
export const attendanceGeneration = () => generation;
const changed = () => {
  window.dispatchEvent(new Event('bnature-attendance-changed'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('bnature-attendance');
    channel.postMessage('changed');
    channel.close();
  }
};
async function encryptionKey() {
  let row = await attendanceDatabase.keys.get('v1');
  if (!row) {
    const key = await Dexie.waitFor(
      crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    );
    await attendanceDatabase.keys.put({ id: 'v1', key });
    row = { id: 'v1', key };
  }
  return row.key;
}
async function seal(value: unknown): Promise<Cipher> {
  const key = await encryptionKey(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await Dexie.waitFor(
    crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return { iv: iv.buffer, cipher };
}
async function unseal<T>(data: Cipher): Promise<T> {
  const key = (await attendanceDatabase.keys.get('v1'))?.key;
  if (!key) throw new Error('eventOfflineLocked');
  const plain = await Dexie.waitFor(
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.iv }, key, data.cipher),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
export async function purgeAttendance() {
  generation++;
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    attendanceDatabase.context,
    async () => {
      await attendanceDatabase.copies.clear();
      await attendanceDatabase.outbox.clear();
      await attendanceDatabase.keys.clear();
      await attendanceDatabase.context.clear();
    },
  );
  changed();
}
export async function expireAttendance() {
  const expired = await attendanceDatabase.copies
    .where('expiresAt')
    .belowOrEqual(new Date().toISOString())
    .toArray();
  for (const copy of expired) await removePreparedEvent(copy.id);
}
export async function removePreparedEvent(id: string) {
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    async () => {
      await attendanceDatabase.copies.delete(id);
      await attendanceDatabase.outbox.where('eventOccurrenceId').equals(id).delete();
    },
  );
  changed();
}
export async function bindAttendanceUser(me: Me) {
  await expireAttendance();
  const context = await attendanceDatabase.context.get('owner');
  if (
    (context &&
      (context.userId !== me.user.id || context.organizationId !== me.activeOrganizationId)) ||
    !me.permissions.includes('attendance:write')
  )
    await purgeAttendance();
}
export async function savePreparedAttendance(
  me: Me,
  snapshot: AttendanceSnapshot,
  version = generation,
) {
  if (version !== generation) throw new Error('eventOfflineLocked');
  if (
    !me.permissions.includes('attendance:write') ||
    snapshot.organizationId !== me.activeOrganizationId
  )
    throw new Error('eventOfflineLocked');
  // Loaded on demand (outside the IndexedDB transaction): the contracts barrel pulls in zod,
  // Temporal and rrule, which the startup bundle does not need.
  const parsed = (await import('@bnature/contracts')).attendanceSnapshotSchema.parse(snapshot);
  await bindAttendanceUser(me);
  if (version !== generation) throw new Error('eventOfflineLocked');
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    attendanceDatabase.context,
    async () => {
      if (version !== generation) throw new Error('eventOfflineLocked');
      if (
        await attendanceDatabase.outbox
          .where('eventOccurrenceId')
          .equals(snapshot.eventOccurrenceId)
          .count()
      )
        throw new Error('eventOfflinePending');
      await attendanceDatabase.context.put({
        id: 'owner',
        userId: me.user.id,
        organizationId: me.activeOrganizationId,
      });
      await attendanceDatabase.copies.put({
        id: snapshot.eventOccurrenceId,
        userId: me.user.id,
        organizationId: me.activeOrganizationId,
        expiresAt: snapshot.expiresAt,
        data: await seal(parsed),
      });
    },
  );
  changed();
}
export async function preparedAttendance() {
  await expireAttendance();
  return attendanceDatabase.transaction(
    'r',
    attendanceDatabase.copies,
    attendanceDatabase.keys,
    async () => {
      const rows = await attendanceDatabase.copies.toArray();
      const copies: AttendanceSnapshot[] = [];
      for (const row of rows) copies.push(await unseal<AttendanceSnapshot>(row.data));
      return copies;
    },
  );
}
export async function queuedAttendance(eventId?: string) {
  await expireAttendance();
  return attendanceDatabase.transaction(
    'r',
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    async () => {
      const rows = eventId
        ? await attendanceDatabase.outbox.where('eventOccurrenceId').equals(eventId).toArray()
        : await attendanceDatabase.outbox.toArray();
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const items: QueuedAttendance[] = [];
      for (const row of rows) items.push(await unseal<QueuedAttendance>(row.data));
      return items.sort(
        (a, b) =>
          a.registrationId.localeCompare(b.registrationId) ||
          a.expectedVersion - b.expectedVersion ||
          a.operationId.localeCompare(b.operationId),
      );
    },
  );
}
export async function queueAttendanceChange(
  eventId: string,
  registrationId: string,
  status: AttendanceOperation['requestedStatus'],
) {
  const version = generation;
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    attendanceDatabase.context,
    async () => {
      if (version !== generation) throw new Error('eventOfflineLocked');
      const copy = await attendanceDatabase.copies.get(eventId),
        owner = await attendanceDatabase.context.get('owner');
      if (
        !copy ||
        !owner ||
        copy.userId !== owner.userId ||
        copy.organizationId !== owner.organizationId ||
        Date.parse(copy.expiresAt) <= Date.now()
      )
        throw new Error('eventOfflineExpired');
      const snapshot = await unseal<AttendanceSnapshot>(copy.data),
        row = snapshot.participants.find((p) => p.registrationId === registrationId);
      if (!row || row.registrationStatus !== 'registered') throw new Error('eventOfflineLocked');
      const op: QueuedAttendance = {
        operationId: crypto.randomUUID(),
        organizationId: copy.organizationId,
        eventOccurrenceId: eventId,
        registrationId,
        requestedStatus: status,
        expectedVersion: row.version,
        clientCreatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      // Monotonic projected versions provide an explicit dependency chain for rapid local edits.
      row.status = status;
      row.version++;
      row.checkedInAt = status === 'present' ? op.clientCreatedAt : null;
      await attendanceDatabase.outbox.add({
        id: op.operationId,
        userId: copy.userId,
        organizationId: copy.organizationId,
        eventOccurrenceId: eventId,
        registrationId,
        createdAt: op.clientCreatedAt,
        data: await seal(op),
      });
      await attendanceDatabase.copies.put({ ...copy, data: await seal(snapshot) });
    },
  );
  changed();
}
async function markResult(op: QueuedAttendance, result: AttendanceResult, version: number) {
  if (version !== generation) return;
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    async () => {
      if (version !== generation) return;
      const row = await attendanceDatabase.outbox.get(op.operationId);
      if (!row) return;
      if (result.status === 'applied') {
        await attendanceDatabase.outbox.delete(op.operationId);
        const remains = await attendanceDatabase.outbox
          .where('registrationId')
          .equals(op.registrationId)
          .count();
        const copy = await attendanceDatabase.copies.get(op.eventOccurrenceId);
        if (copy && !remains && result.record) {
          const snapshot = await unseal<AttendanceSnapshot>(copy.data),
            participant = snapshot.participants.find((p) => p.registrationId === op.registrationId);
          if (participant) {
            participant.status = result.record.status;
            participant.version = result.record.version;
            participant.checkedInAt = result.record.checkedInAt;
          }
          await attendanceDatabase.copies.put({ ...copy, data: await seal(snapshot) });
        }
      } else
        await attendanceDatabase.outbox.put({
          ...row,
          data: await seal({
            ...op,
            syncStatus: result.status === 'conflict' ? 'conflict' : 'error',
            error: result.code,
            serverRecord: result.record
              ? {
                  status: result.record.status,
                  version: result.record.version,
                  checkedInAt: result.record.checkedInAt,
                  registrationStatus: result.record.registrationStatus,
                }
              : undefined,
          }),
        });
    },
  );
  changed();
}
async function markError(
  op: QueuedAttendance,
  status: 'error' | 'auth_required',
  code: string,
  version: number,
) {
  if (version !== generation) return;
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    async () => {
      const row = await attendanceDatabase.outbox.get(op.operationId);
      if (row && version === generation)
        await attendanceDatabase.outbox.put({
          ...row,
          data: await seal({ ...op, syncStatus: status, error: code }),
        });
    },
  );
  changed();
}
let syncing: Promise<void> | null = null;
export async function synchronizeAttendance() {
  if (syncing) return syncing;
  const run = async () => {
    if (!navigator.onLine) return;
    await expireAttendance();
    const owner = await attendanceDatabase.context.get('owner');
    if (!owner) return;
    const version = generation;
    let me: Me;
    try {
      me = await api<Me>('/me', { headers: { 'X-Organization-Id': owner.organizationId } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await purgeAttendance();
        return;
      }
      if (error instanceof ApiError && error.status === 401)
        for (const op of await queuedAttendance())
          if (op.syncStatus !== 'auth_required')
            await markError(op, 'auth_required', 'UNAUTHENTICATED', version);
      return;
    }
    if (me.user.id !== owner.userId || !me.permissions.includes('attendance:write')) {
      await purgeAttendance();
      return;
    }
    const blocked = new Set<string>();
    for (const op of await queuedAttendance()) {
      if (version !== generation) return;
      if (blocked.has(op.registrationId)) continue;
      if (op.syncStatus === 'conflict' || op.syncStatus === 'error') {
        blocked.add(op.registrationId);
        continue;
      }
      try {
        const { results } = await api<{ results: AttendanceResult[] }>('/attendance/sync', {
          method: 'POST',
          headers: { 'X-Organization-Id': owner.organizationId },
          body: JSON.stringify({
            operations: [
              {
                operationId: op.operationId,
                organizationId: op.organizationId,
                eventOccurrenceId: op.eventOccurrenceId,
                registrationId: op.registrationId,
                requestedStatus: op.requestedStatus,
                expectedVersion: op.expectedVersion,
                clientCreatedAt: op.clientCreatedAt,
              },
            ],
          }),
        });
        const result = results.find((r) => r.operationId === op.operationId);
        if (!result) return;
        if (result.code === 'FORBIDDEN' || result.code === 'NOT_FOUND') {
          await removePreparedEvent(op.eventOccurrenceId);
          blocked.add(op.registrationId);
          continue;
        }
        await markResult(op, result, version);
        if (result.status !== 'applied') blocked.add(op.registrationId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          await removePreparedEvent(op.eventOccurrenceId);
          continue;
        }
        if (error instanceof ApiError && error.status === 401)
          await markError(op, 'auth_required', 'UNAUTHENTICATED', version);
        // Network failures leave the exact operation untouched for an idempotent retry.
        return;
      }
    }
  };
  syncing = run();
  try {
    await syncing;
  } finally {
    syncing = null;
  }
}
export async function resolveAttendanceConflict(operationId: string, choice: 'local' | 'server') {
  await attendanceDatabase.transaction(
    'rw',
    attendanceDatabase.copies,
    attendanceDatabase.outbox,
    attendanceDatabase.keys,
    async () => {
      const queued = await attendanceDatabase.outbox.get(operationId);
      if (!queued) throw new Error('eventOfflineLocked');
      const conflict = await unseal<QueuedAttendance>(queued.data);
      if (!conflict.serverRecord) throw new Error('eventOfflineLocked');
      const copy = await attendanceDatabase.copies.get(conflict.eventOccurrenceId);
      if (!copy) throw new Error('eventOfflineExpired');
      const snapshot = await unseal<AttendanceSnapshot>(copy.data),
        participant = snapshot.participants.find(
          (p) => p.registrationId === conflict.registrationId,
        );
      if (!participant) throw new Error('eventOfflineLocked');
      const localStatus = participant.status;
      const server = conflict.serverRecord;
      await attendanceDatabase.outbox
        .where('registrationId')
        .equals(conflict.registrationId)
        .delete();
      participant.status = server.status;
      participant.version = server.version;
      participant.checkedInAt = server.checkedInAt;
      participant.registrationStatus = server.registrationStatus;
      if (choice === 'local') {
        const op: QueuedAttendance = {
          operationId: crypto.randomUUID(),
          organizationId: copy.organizationId,
          eventOccurrenceId: copy.id,
          registrationId: participant.registrationId,
          requestedStatus: localStatus,
          expectedVersion: server.version,
          clientCreatedAt: new Date().toISOString(),
          syncStatus: 'pending',
        };
        await attendanceDatabase.outbox.add({
          id: op.operationId,
          userId: copy.userId,
          organizationId: copy.organizationId,
          eventOccurrenceId: copy.id,
          registrationId: participant.registrationId,
          createdAt: op.clientCreatedAt,
          data: await seal(op),
        });
        participant.status = localStatus;
        participant.version++;
      }
      await attendanceDatabase.copies.put({ ...copy, data: await seal(snapshot) });
    },
  );
  changed();
}
export async function retryAttendanceErrors(eventId: string) {
  const version = generation;
  for (const op of await queuedAttendance(eventId))
    if (op.syncStatus === 'error' && !op.serverRecord)
      await markError(op, 'auth_required', 'RETRY', version);
}

export async function attendanceOwner() {
  return attendanceDatabase.context.get('owner');
}
