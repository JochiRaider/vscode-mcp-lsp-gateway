import { expect } from 'chai';
import { createSessionStore } from '../../src/server/session.js';

describe('session store', () => {
  it('evicts the oldest sessions deterministically when at capacity', () => {
    const store = createSessionStore({ maxSessions: 2 });
    const id1 = store.create('2025-11-25');
    const id2 = store.create('2025-11-25');
    const id3 = store.create('2025-11-25');

    expect(store.size()).to.equal(2);
    const res1 = store.require(id1);
    expect(res1.ok).to.equal(false);
    if (!res1.ok) expect(res1.status).to.equal(404);

    const res2 = store.require(id2);
    expect(res2.ok).to.equal(true);
    const res3 = store.require(id3);
    expect(res3.ok).to.equal(true);
  });

  it('rejects missing session ids and omits createdAtMs in state', () => {
    const store = createSessionStore({ maxSessions: 1 });
    const missing = store.require(undefined);
    expect(missing.ok).to.equal(false);
    if (!missing.ok) expect(missing.status).to.equal(400);

    const id = store.create('2025-11-25');
    const present = store.require(id);
    expect(present.ok).to.equal(true);
    if (!present.ok) return;
    expect(present.session.protocolVersion).to.equal('2025-11-25');
    expect(present.session.initializedNotificationSeen).to.equal(false);
    expect(Object.prototype.hasOwnProperty.call(present.session, 'createdAtMs')).to.equal(false);
  });
});
