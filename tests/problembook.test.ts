import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveProblems, type Marker } from '../lib/problembook.ts';

const marker = (id: string, page: number, column: 'left' | 'right', y: number, type: Marker['type']): Marker => ({ id, page, column, y, type });
test('Start와 End 사이를 한 문제로 만든다', () => {
  const result = deriveProblems([
    marker('a', 1, 'left', 0.2, 'start'),
    marker('b', 1, 'left', 0.5, 'end'),
  ], 1);
  assert.equal(result.problems.length, 1);
  assert.deepEqual(result.problems[0].fragments, [{ page: 1, column: 'left', yStart: 0.2, yEnd: 0.5 }]);
});

test('다음 단까지 이어지는 문제를 여러 조각으로 묶는다', () => {
  const result = deriveProblems([
    marker('a', 1, 'left', 0.8, 'start'),
    marker('b', 1, 'right', 0.3, 'end'),
  ], 1);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].fragments.length, 2);
  assert.deepEqual(result.problems[0].fragments[1], { page: 1, column: 'right', yStart: 0, yEnd: 0.3 });
});

test('연속 Start는 앞 문제를 닫고 새 문제를 연다', () => {
  const result = deriveProblems([
    marker('a', 1, 'left', 0.1, 'start'),
    marker('b', 1, 'left', 0.4, 'start'),
    marker('c', 1, 'left', 0.7, 'end'),
  ], 1);
  assert.equal(result.problems.length, 2);
  assert.equal(result.problems[0].fragments[0].yEnd, 0.4);
  assert.equal(result.problems[1].fragments[0].yStart, 0.4);
});

test('Start 없는 End를 경고한다', () => {
  const result = deriveProblems([marker('a', 1, 'left', 0.5, 'end')], 1);
  assert.equal(result.problems.length, 0);
  assert.equal(result.warnings.length, 1);
});
