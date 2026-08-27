import assert from 'node:assert/strict';
import test from 'node:test';
import { getShortcutAction } from '../lib/shortcuts.ts';

test('문제 자르기 단축키를 편집 동작으로 변환한다', () => {
  assert.equal(getShortcutAction({ key: 's' }), 'start');
  assert.equal(getShortcutAction({ key: 'C' }), 'continue');
  assert.equal(getShortcutAction({ key: 'e' }), 'end');
  assert.equal(getShortcutAction({ key: 'x' }), 'delete');
  assert.equal(getShortcutAction({ key: 'ArrowLeft' }), 'previous-page');
  assert.equal(getShortcutAction({ key: 'ArrowRight' }), 'next-page');
  assert.equal(getShortcutAction({ key: 'z', ctrlKey: true }), 'undo');
});

test('입력란에서는 단축키를 가로채지 않는다', () => {
  assert.equal(getShortcutAction({ key: 's', editable: true }), null);
  assert.equal(getShortcutAction({ key: 'Backspace', editable: true }), null);
});
