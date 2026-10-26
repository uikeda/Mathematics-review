/*
 * チャット AI の返答（【問題】【出典】形式のテキスト）から登録候補を取り出す
 * ブラウザでは window.MathReviewParser、Node では module.exports として使う。
 */
(function (root) {
  'use strict';

  // 要点・解答などは記録しないが、内容が出典に混ざらないよう見出しとしては認識して読み捨てる
  const FIELDS = { 問題: 'text', 出典: 'source', 要点: 'ignored', 解答: 'ignored', 解説: 'ignored', ヒント: 'ignored' };

  // 行頭の Markdown 記号（# > * - _）や太字を許し、見出しの後ろに同じ行で内容が続いてもよい
  const MARKER = /^[\s>#*_-]*【\s*(問題|出典|要点|解答|解説|ヒント)\s*】[\s*_:：]*(.*)$/;
  const FENCE = /^\s*(```|~~~)/;
  const SEPARATOR = /^\s*([-=*_])\1{2,}\s*$/;
  const EMPTY_SOURCE = /^[（(]?(なし|不明|空欄|記載なし|-|ー|—)[）)]?$/;

  function clean(lines) {
    return lines
      .filter((line) => !SEPARATOR.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseProposalText(raw) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let current = null;
    let field = null;

    for (const line of lines) {
      if (FENCE.test(line)) continue;
      const m = line.match(MARKER);
      if (m) {
        field = FIELDS[m[1]];
        if (field === 'text' || !current) {
          current = { text: [], source: [], ignored: [] };
          blocks.push(current);
        }
        const rest = m[2].replace(/[*_]+\s*$/, '');
        if (rest.trim()) current[field].push(rest);
        continue;
      }
      if (current) current[field].push(line);
    }

    return blocks
      .map((b) => {
        let source = clean(b.source).replace(/\s*\n\s*/g, ' ');
        if (EMPTY_SOURCE.test(source)) source = '';
        return { text: clean(b.text), source };
      })
      .filter((p) => p.text);
  }

  const api = { parseProposalText };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MathReviewParser = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
