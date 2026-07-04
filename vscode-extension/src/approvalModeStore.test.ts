import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalModeStore, type MementoLike } from './approvalModeStore';

function fakeMemento(initial: Record<string, unknown> = {}): MementoLike {
  const data = { ...initial };
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in data ? data[key] : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      data[key] = value;
      return Promise.resolve();
    },
  };
}

test('defaults to "ask" when nothing has been persisted', () => {
  const store = new ApprovalModeStore(fakeMemento());
  assert.equal(store.get(), 'ask');
});

test('persists a set mode across a fresh store instance sharing the same memento', () => {
  const memento = fakeMemento();
  const storeA = new ApprovalModeStore(memento);
  const storeB = new ApprovalModeStore(memento);
  return storeA.set('auto').then(() => {
    assert.equal(storeB.get(), 'auto');
  });
});

test('falls back to "ask" if the persisted value is corrupt or from an old schema', () => {
  const store = new ApprovalModeStore(fakeMemento({ 'eminentai.approvalMode': 'yolo-mode' }));
  assert.equal(store.get(), 'ask');
});

test('falls back to "ask" if the persisted value is not a string at all', () => {
  const store = new ApprovalModeStore(fakeMemento({ 'eminentai.approvalMode': 42 }));
  assert.equal(store.get(), 'ask');
});
