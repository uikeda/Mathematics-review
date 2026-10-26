const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

const day = (d, h = 12) => new Date(2026, 9, d, h, 0, 0); // 2026年10月d日

function reviewAt(p, result, d) {
  return L.applyReview(p, result, day(d));
}

test('未判定の問題は登録した日から復習対象になる', () => {
  const p = L.createProblem({ text: 'q', source: 's' }, day(1));
  assert.equal(p.status, 'unrated');
  assert.equal(L.isDue(p, day(1)), true);
});

test('解けた → ○、解けなかった → ×', () => {
  const p = L.createProblem({ text: 'q' }, day(1));
  assert.equal(reviewAt(p, 'solved', 1).status, 'ok');
  assert.equal(reviewAt(p, 'wrong', 1).status, 'wrong');
});

test('未判定から要点を即答しても即答回数には数えない（○になってから数える）', () => {
  const p = reviewAt(L.createProblem({ text: 'q' }, day(1)), 'quick', 1);
  assert.equal(p.status, 'ok');
  assert.equal(p.quickCount, 0);
});

test('○ で要点を累計3回即答すると ◎ になる', () => {
  let p = reviewAt(L.createProblem({ text: 'q' }, day(1)), 'solved', 1);
  p = reviewAt(p, 'quick', 4);
  assert.equal(p.status, 'ok');
  assert.equal(p.quickCount, 1);
  p = reviewAt(p, 'solved', 11); // 即答できなかった回は数えないが ○ のまま
  assert.equal(p.status, 'ok');
  assert.equal(p.quickCount, 1);
  p = reviewAt(p, 'quick', 18);
  assert.equal(p.quickCount, 2);
  p = reviewAt(p, 'quick', 25);
  assert.equal(p.status, 'mastered');
  assert.equal(p.quickCount, 0);
});

test('○ で解けなかったら × になり即答回数はリセット', () => {
  let p = reviewAt(L.createProblem({ text: 'q' }, day(1)), 'solved', 1);
  p = reviewAt(p, 'quick', 4);
  p = reviewAt(p, 'quick', 11);
  p = reviewAt(p, 'wrong', 25);
  assert.equal(p.status, 'wrong');
  assert.equal(p.quickCount, 0);
});

test('◎ で要点がすぐ出なければ ○ に戻る', () => {
  const p = L.setStatusManually(L.createProblem({ text: 'q' }, day(1)), 'mastered', day(1));
  assert.equal(reviewAt(p, 'quick', 2).status, 'mastered');
  assert.equal(reviewAt(p, 'solved', 2).status, 'ok');
  assert.equal(reviewAt(p, 'wrong', 2).status, 'wrong');
});

test('復習間隔: × 1日, ○ 3/7/14日, ◎ 30日', () => {
  let p = reviewAt(L.createProblem({ text: 'q' }, day(1)), 'wrong', 1);
  assert.equal(L.dueDateKey(p), '2026-10-02');
  p = reviewAt(p, 'solved', 2);
  assert.equal(L.dueDateKey(p), '2026-10-05');
  p = reviewAt(p, 'quick', 5);
  assert.equal(L.dueDateKey(p), '2026-10-12');
  p = reviewAt(p, 'quick', 12);
  assert.equal(L.dueDateKey(p), '2026-10-26');
  p = reviewAt(p, 'quick', 26);
  assert.equal(p.status, 'mastered');
  assert.equal(L.dueDateKey(p), '2026-11-25');
});

test('時刻ではなく日付で判定する（夜に復習しても翌朝に出る）', () => {
  const p = L.applyReview(L.createProblem({ text: 'q' }, day(1)), 'wrong', day(1, 23));
  assert.equal(L.isDue(p, day(2, 6)), true);
  assert.equal(L.isDue(p, day(1, 23)), false);
});

test('復習リストは × → 未判定 → ○ → ◎ の順、同じ状況なら予定日が古い順', () => {
  const mk = (status, reviewedDay) => {
    const p = L.createProblem({ text: status }, day(1));
    return { ...L.setStatusManually(p, status, day(reviewedDay)), text: `${status}${reviewedDay}` };
  };
  const list = [
    mk('mastered', 1),
    mk('ok', 5),
    mk('ok', 1),
    L.createProblem({ text: 'new' }, day(3)),
    mk('wrong', 9),
  ];
  const order = L.dueProblems(list, day(20)).map((p) => p.text);
  assert.deepEqual(order, ['wrong9', 'new', 'ok1', 'ok5']);
});

test('nextUpcoming は最も近い予定日とその件数を返す', () => {
  const a = reviewAt(L.createProblem({ text: 'a' }, day(1)), 'wrong', 1);
  const b = reviewAt(L.createProblem({ text: 'b' }, day(1)), 'wrong', 1);
  const c = reviewAt(L.createProblem({ text: 'c' }, day(1)), 'solved', 1);
  assert.deepEqual(L.nextUpcoming([a, b, c], day(1)), { dateKey: '2026-10-02', count: 2 });
});

test('normalize は壊れたデータを既定値で補う', () => {
  const p = L.normalize({ text: 'x', status: 'bogus', quickCount: -1 });
  assert.equal(p.status, 'unrated');
  assert.equal(p.quickCount, 0);
  assert.equal(p.source, '');
  assert.ok(p.id);
  assert.deepEqual(p.history, []);
  assert.deepEqual(p.images, []);
  assert.deepEqual(L.normalize({ images: ['img-1', 3, '', 'img-2'] }).images, ['img-1', 'img-2']);
  // 要点は記録しない（以前のデータに残っていても読み込み時に外す）
  assert.equal('keypoint' in L.normalize({ text: 'x', keypoint: 'old' }), false);
});

test('写真つきの問題を作れる（問題文は空でもよい）', () => {
  const p = L.createProblem({ text: '', images: ['img-1', 'img-2'] }, day(1));
  assert.deepEqual(p.images, ['img-1', 'img-2']);
  assert.equal(p.text, '');
  assert.equal(L.isDue(p, day(1)), true);
});
