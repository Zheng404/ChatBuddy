import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../chatbuddy/stateSanitizers';
import {
  SQLITE_STATE_KEY,
  StatePersistenceService
} from '../chatbuddy/stateRepositoryPersistenceService';
import type { PersistedStateLite } from '../chatbuddy/types';

test('persist can recover after a failed persist attempt', async () => {
  let state: PersistedStateLite = createInitialState();
  let persistedPayload: string | undefined;
  let setKvCalls = 0;
  let flushCalls = 0;

  const storage = {
    getKv: () => undefined,
    setKv: (key: string, value: string) => {
      if (key === SQLITE_STATE_KEY) {
        persistedPayload = value;
      }
      setKvCalls += 1;
    },
    flush: async () => {
      flushCalls += 1;
      if (flushCalls === 1) {
        throw new Error('flush failed once');
      }
    }
  };

  const persistence = new StatePersistenceService({
    storage: storage as unknown as ConstructorParameters<typeof StatePersistenceService>[0]['storage'],
    storageReady: () => true,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    getProviderApiKeys: () => ({}),
    setProviderApiKeys: () => undefined,
    bumpVersion: () => undefined
  });

  (persistence as unknown as { persistMaxRetries: number }).persistMaxRetries = 0;
  (persistence as unknown as { persistRetryDelayMs: number }).persistRetryDelayMs = 1;

  await assert.rejects(persistence.persist(), /flush failed once/);
  await persistence.persist();

  assert.equal(flushCalls, 2);
  assert.equal(setKvCalls, 2);
  assert.ok(persistedPayload);
});
