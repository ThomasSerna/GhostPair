import assert from 'node:assert/strict';

/** Shared contract for both real storage adapters; open() reopens the same DB. */
export async function deviceContract(open) {
  let store = await open();
  let identities;
  try {
    await store.initialize(); await store.check();
    identities = (await Promise.all(Array.from({ length: 12 }, () => store.register(4)))).filter(Boolean);
    assert.equal(identities.length, 4);
    assert.equal(new Set(identities.map(i => i.deviceId)).size, 4);
    for (const identity of identities) {
      assert.match(identity.deviceId, /^[a-f0-9]{32}$/); assert.match(identity.ownerToken, /^[a-f0-9]{64}$/);
      assert.equal(await store.authenticate(identity.deviceId, identity.ownerToken), true);
      assert.equal(await store.authenticate(identity.deviceId, 'wrong'), false);
    }
    assert.equal(await store.authenticate('0'.repeat(32), identities[0].ownerToken), false);
  } finally { await store.close(); }
  store = await open();
  try {
    await store.initialize();
    for (const identity of identities) assert.equal(await store.authenticate(identity.deviceId, identity.ownerToken), true);
    assert.equal(await store.register(4), null);
  } finally { await store.close(); }
  return identities;
}
