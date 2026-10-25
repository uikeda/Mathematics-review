const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProposalText } = require('../js/proposal-parser.js');

test('基本の形式を読み取り、LaTeX のバックスラッシュをそのまま残す', () => {
  const text = [
    '```text',
    '【問題】',
    '$\\frac{1}{2} \\times x = 3$ を解け。',
    '(1) 方程式を立てよ。',
    '(2) $x$ を求めよ。',
    '【出典】',
    '青チャート数学I・A 例題12',
    '【要点】',
    '両辺に $2$ を掛けて $x$ を孤立させる',
    '```',
  ].join('\n');
  assert.deepEqual(parseProposalText(text), [
    {
      text: '$\\frac{1}{2} \\times x = 3$ を解け。\n(1) 方程式を立てよ。\n(2) $x$ を求めよ。',
      source: '青チャート数学I・A 例題12',
      keypoint: '両辺に $2$ を掛けて $x$ を孤立させる',
    },
  ]);
});

test('複数の問題を区切り線つきで読み取る', () => {
  const text = `前置きの文章は無視する

【問題】
問1
【出典】
本A
【要点】
要点1

---

【問題】
$$\\int_0^1 x^2\\,dx$$ を求めよ。
【出典】
【要点】
原始関数を使う`;
  const result = parseProposalText(text);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, '問1');
  assert.equal(result[0].keypoint, '要点1');
  assert.equal(result[1].text, '$$\\int_0^1 x^2\\,dx$$ を求めよ。');
  assert.equal(result[1].source, '');
});

test('Markdown の太字・見出しや同じ行の内容にも対応する', () => {
  const text = `### 【問題】
$a^2$ を展開せよ。
**【出典】** 2023年 東大 第3問
**【要点】：公式を使う**`;
  assert.deepEqual(parseProposalText(text), [
    { text: '$a^2$ を展開せよ。', source: '2023年 東大 第3問', keypoint: '公式を使う' },
  ]);
});

test('出典が「なし」「不明」なら空にする', () => {
  for (const s of ['なし', '不明', '（なし）', '(不明)', '-']) {
    const [p] = parseProposalText(`【問題】\nq\n【出典】\n${s}\n【要点】\nk`);
    assert.equal(p.source, '', s);
  }
});

test('問題文の無いものや形式に合わないテキストは候補にしない', () => {
  assert.deepEqual(parseProposalText('【出典】\n本\n【要点】\nk'), []);
  assert.deepEqual(parseProposalText('ただの文章です'), []);
  assert.deepEqual(parseProposalText(''), []);
});

test('Windows の改行コードでも読み取れる', () => {
  const [p] = parseProposalText('【問題】\r\n問\r\n【出典】\r\n本\r\n【要点】\r\nk\r\n');
  assert.deepEqual(p, { text: '問', source: '本', keypoint: 'k' });
});
