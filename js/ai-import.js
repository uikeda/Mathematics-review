/*
 * 「AIで追加」画面
 * 指示文をコピーして手持ちのチャット AI（ChatGPT・Claude・Gemini など）に送り、
 * 返答を貼り付けて登録候補として読み込む。API キーや外部への通信は使わない。
 */
(function () {
  'use strict';

  const App = window.MathReviewApp;
  const { el, mathBlock, toast } = App;
  const $ = (sel) => document.querySelector(sel);

  const PROMPT = `数学の問題を復習ノートアプリに登録したいので、添付した画像（または下に書いた文章）の問題を、次の形式で書き起こしてください。

## 出力形式
- 全体を1つのコードブロック（\`\`\`text で始める）に入れ、コードブロックの外には何も書かない。
- 問題が複数あるときは、次のまとまりを問題の数だけ繰り返す。

【問題】
（問題文）
【出典】
（出典）

## 各項目の書き方
- 問題文: 原文に忠実に書き起こす。数式は LaTeX で書き、文中は $...$、別行は $$...$$ で囲む。小問は (1) (2) のように改行して並べる。図がある問題は、解くのに必要な図の情報を文章で補う。読み取れない箇所は [判読不能] と書く。
- 出典: 書名と問題番号、大学名・年度・大問番号など。私が示したものか、画像から読み取れるものだけを書き、推測で作らない。分からなければ空欄にする。
- 解答・解説・ヒントは書かない（要点は自分で書くため）。`;

  let proposals = [];
  let errorText = '';

  // ---------- 指示文 ----------

  function buildPrompt() {
    const note = $('#paste-note').value.trim();
    return note ? `${PROMPT}\n\n## 補足\n${note}` : PROMPT;
  }

  function updatePromptPreview() {
    $('#paste-prompt').textContent = buildPrompt();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // clipboard API が使えない環境（file:// など）では選択してコピーする
      const area = el('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
      area.value = text;
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      area.remove();
      return ok;
    }
  }

  async function onCopy() {
    if (await copyText(buildPrompt())) {
      toast('指示文をコピーしました。チャット AI に貼り付けてください');
    } else {
      $('#paste-prompt-box').open = true;
      toast('コピーできませんでした。下の指示文を選択してコピーしてください');
    }
  }

  // ---------- 返答の読み込み ----------

  function onLoad() {
    const raw = $('#paste-input').value;
    if (!raw.trim()) {
      $('#paste-input').focus();
      return;
    }
    const parsed = window.MathReviewParser.parseProposalText(raw);
    // 要点は自分で書く。AI が書いてきても使わない
    proposals = parsed.map(({ text, source }) => ({ fields: { text, source, keypoint: '' }, addedId: null }));
    errorText = parsed.length
      ? ''
      : '問題を読み取れませんでした。AI の返答に【問題】【出典】【要点】の見出しが含まれているか確認してください。';
    render();
  }

  function onClear() {
    $('#paste-input').value = '';
    proposals = [];
    errorText = '';
    render();
  }

  function addProposals(targets) {
    const fresh = targets.filter((p) => !p.addedId);
    fresh.forEach((p) => {
      p.addedId = App.addProblem(p.fields).id;
    });
    if (fresh.length) toast(fresh.length > 1 ? `${fresh.length}問を追加しました` : '追加しました');
    render();
  }

  // ---------- 表示 ----------

  function proposalCard(proposal) {
    const f = proposal.fields;
    const duplicate = !proposal.addedId && App.hasProblemText(f.text);
    return el('div', { class: `proposal ${proposal.addedId ? 'added' : ''}` },
      mathBlock(f.text, 'problem-text'),
      el('div', { class: 'proposal-meta' },
        el('span', { class: 'proposal-label' }, '出典'),
        f.source ? el('span', {}, f.source) : el('span', { class: 'muted' }, '（なし）'),
      ),
      proposal.addedId ? addedKeypoint(f) : keypointInput(f),
      duplicate ? el('p', { class: 'warn' }, '同じ問題文がすでに登録されています。') : null,
      proposal.addedId
        ? el('p', { class: 'added-label' }, '追加しました（未判定）')
        : el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn primary small', onclick: () => addProposals([proposal]) }, '追加'),
          el('button', { type: 'button', class: 'btn small', onclick: () => App.openDraft(f, (p) => { proposal.addedId = p.id; }) }, '編集して追加'),
        ),
    );
  }

  function addedKeypoint(f) {
    return el('div', { class: 'proposal-meta' },
      el('span', { class: 'proposal-label' }, '要点'),
      f.keypoint ? mathBlock(f.keypoint) : el('span', { class: 'muted' }, '（なし）'),
    );
  }

  // 要点の入力欄（入力した内容は候補に保持し、「追加」「すべて追加」「編集して追加」で使う）
  function keypointInput(f) {
    const preview = el('div', { class: 'keypoint-preview' });
    // 数式を含むときだけ表示を確かめられるようにする
    const updatePreview = () => {
      preview.hidden = !/\$|\\\(|\\\[/.test(f.keypoint);
      preview.replaceChildren(mathBlock(f.keypoint));
    };
    const input = el('textarea', {
      class: 'keypoint-input',
      rows: 2,
      placeholder: '例: 因数分解 $(x-2)(x-3)=0$ に気づく',
      oninput: (event) => {
        f.keypoint = event.target.value;
        updatePreview();
      },
    });
    input.value = f.keypoint;
    updatePreview();
    return el('label', { class: 'field keypoint-field' },
      el('span', { class: 'proposal-label' }, '要点（自分で書く・あとからでも可）'),
      input,
      preview,
    );
  }

  function render() {
    const box = $('#paste-result');
    if (errorText) {
      box.replaceChildren(el('div', { class: 'error-box' }, errorText));
      return;
    }
    if (proposals.length === 0) {
      box.replaceChildren();
      return;
    }
    const remaining = proposals.filter((p) => !p.addedId);
    box.replaceChildren(
      el('div', { class: 'card' },
        el('p', { class: 'paste-summary' }, `${proposals.length}問を読み取りました。問題文を確認し、要点を書いてから追加してください。`),
        el('div', { class: 'proposals' },
          proposals.map(proposalCard),
          remaining.length > 1
            ? el('button', { type: 'button', class: 'btn small', onclick: () => addProposals(remaining) }, `残りの${remaining.length}問をすべて追加`)
            : null,
        ),
      ),
    );
  }

  // ---------- 初期化 ----------

  function init() {
    $('#paste-note').addEventListener('input', updatePromptPreview);
    $('#paste-copy').addEventListener('click', onCopy);
    $('#paste-load').addEventListener('click', onLoad);
    $('#paste-clear').addEventListener('click', onClear);
    App.onViewChange((view) => {
      // 一覧などで問題が増減したら「登録済み」の表示を更新する
      if (view === 'ai') render();
    });
    updatePromptPreview();
    render();
  }

  init();
})();
