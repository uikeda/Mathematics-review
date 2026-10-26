/*
 * 「問題を追加」画面
 * - AI で書き起こす: 指示文をコピーして手持ちのチャット AI（ChatGPT・Claude・Gemini など）に送り、
 *   返答を貼り付けて登録候補として読み込む。API キーや外部への通信は使わない。
 * - 写真をそのまま: 選んだ写真を問題文の代わりにした登録候補を作る。
 */
(function () {
  'use strict';

  const App = window.MathReviewApp;
  const { el, mathBlock, imageGallery, toast } = App;
  const Images = window.MathReviewImages;
  const $ = (sel) => document.querySelector(sel);
  const METHOD_KEY = 'math-review.add-method';

  const PROMPT = `数学の問題を復習ノートアプリに登録したいので、添付した画像（または下に書いた文章）の問題を、次の形式で書き起こしてください。

## 出力形式
- 全体を1つのコードブロック（\`\`\`text で始める）に入れ、コードブロックの外には何も書かない。
- 問題が複数あるとき（画像が複数枚あるとき、1枚に複数の問題があるときを含む）は、すべての問題について、次のまとまりを問題の数だけ繰り返す。小問は分けずに1つの問題としてまとめる。

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
    if (parsed.length === 0) {
      errorText = '問題を読み取れませんでした。AI の返答に【問題】【出典】の見出しが含まれているか確認してください。';
      render();
      return;
    }
    // 何回かに分けて貼り付けられるように、候補は置き換えずに後ろへ足していく。
    // 同じ返答を二度貼ったときのために、問題文が同じ候補は除く
    const known = new Set(proposals.map((p) => p.fields.text).filter(Boolean));
    const fresh = parsed.filter((p) => {
      if (known.has(p.text)) return false;
      known.add(p.text);
      return true;
    });
    // 要点は自分で書く。AI が書いてきても使わない
    proposals = proposals.concat(fresh.map(({ text, source }) => newProposal({ text, source })));
    errorText = '';
    $('#paste-input').value = '';
    const skipped = parsed.length - fresh.length;
    toast(`${fresh.length}問を読み込みました${skipped ? `（読み込み済みの${skipped}問は除外）` : ''}`);
    render();
  }

  function newProposal({ text = '', source = '', images = [] }) {
    return { fields: { text, source, keypoint: '', images }, addedId: null };
  }

  // ---------- 写真をそのまま ----------

  async function onPhotoFiles(event) {
    const files = [...event.target.files].filter((f) => f.type.startsWith('image/'));
    event.target.value = '';
    if (!files.length) return;
    const images = [];
    for (const file of files) {
      try {
        images.push(await Images.fromFile(file));
      } catch (e) {
        toast(e.message);
      }
    }
    if (!images.length) return;
    const fresh = $('#photo-merge').checked
      ? [newProposal({ images })]
      : images.map((img) => newProposal({ images: [img] }));
    proposals = proposals.concat(fresh);
    errorText = '';
    toast(`写真から${fresh.length}問の候補を作りました`);
    render();
  }

  // ---------- 追加の方法の切り替え ----------

  function loadMethod() {
    try {
      return localStorage.getItem(METHOD_KEY) === 'photo' ? 'photo' : 'ai';
    } catch (e) {
      return 'ai';
    }
  }

  function setMethod(method) {
    try {
      localStorage.setItem(METHOD_KEY, method);
    } catch (e) {
      /* 次回は既定の方法で開く */
    }
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.method === method));
    });
    $('#method-ai').hidden = method !== 'ai';
    $('#method-photo').hidden = method !== 'photo';
  }

  function onClearInput() {
    $('#paste-input').value = '';
    errorText = '';
    render();
  }

  function onClearProposals() {
    const remaining = proposals.filter((p) => !p.addedId).length;
    if (remaining && !confirm(`まだ追加していない候補が${remaining}問あります。候補の一覧を消しますか？`)) return;
    proposals = [];
    render();
  }

  let adding = false;

  async function addProposals(targets) {
    if (adding) return;
    adding = true;
    const fresh = targets.filter((p) => !p.addedId);
    let added = 0;
    try {
      for (const p of fresh) {
        p.fields = { ...p.fields, source: p.fields.source.trim(), keypoint: p.fields.keypoint.trim() };
        p.addedId = (await App.addProblem(p.fields)).id;
        added++;
      }
    } catch (e) {
      console.error(e);
      alert('写真を保存できませんでした。ブラウザの保存容量や設定を確認してください。');
    } finally {
      adding = false;
    }
    if (added) toast(added > 1 ? `${added}問を追加しました` : '追加しました');
    render();
  }

  // ---------- 表示 ----------

  function proposalCard(proposal) {
    const f = proposal.fields;
    const duplicate = !proposal.addedId && App.hasProblemText(f.text);
    return el('div', { class: `proposal ${proposal.addedId ? 'added' : ''}` },
      f.text ? mathBlock(f.text, 'problem-text') : null,
      f.images.length ? imageGallery(f.images, 'thumbs') : null,
      proposal.addedId ? addedSource(f) : sourceInput(f),
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

  function addedSource(f) {
    return el('div', { class: 'proposal-meta' },
      el('span', { class: 'proposal-label' }, '出典'),
      f.source ? el('span', {}, f.source) : el('span', { class: 'muted' }, '（なし）'),
    );
  }

  // 出典の入力欄（AI が読み取った出典を初期値にし、書き換えた内容を候補に保持する）
  function sourceInput(f) {
    const input = el('input', {
      type: 'text',
      class: 'source-input',
      list: 'source-options',
      placeholder: '例: 青チャート数学I・A 例題12',
      oninput: (event) => {
        f.source = event.target.value;
      },
    });
    input.value = f.source;
    return el('label', { class: 'field proposal-field' },
      el('span', { class: 'proposal-label' }, '出典'),
      input,
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
    return el('label', { class: 'field proposal-field' },
      el('span', { class: 'proposal-label' }, '要点（自分で書く・あとからでも可）'),
      input,
      preview,
    );
  }

  function render() {
    const box = $('#paste-result');
    const remaining = proposals.filter((p) => !p.addedId);
    // replaceChildren は null を「null」という文字として入れてしまうので、el で包んで null を除く
    box.replaceChildren(el('div', {},
      errorText ? el('div', { class: 'error-box' }, errorText) : null,
      proposals.length
        ? el('div', { class: 'card' },
          el('div', { class: 'paste-summary-row' },
            el('p', { class: 'paste-summary' }, `候補 ${proposals.length}問（未追加 ${remaining.length}問）`),
            el('button', { type: 'button', class: 'btn small', onclick: onClearProposals }, '候補の一覧を消す'),
          ),
          el('p', { class: 'hint' }, '問題文や写真を確認し、要点を書いてから追加してください。続けて読み込んだ返答や選んだ写真は、この下に追加されます。'),
          el('div', { class: 'proposals' },
            proposals.map(proposalCard),
            remaining.length > 1
              ? el('button', { type: 'button', class: 'btn small', onclick: () => addProposals(remaining) }, `残りの${remaining.length}問をすべて追加`)
              : null,
          ),
        )
        : null,
    ));
  }

  // ---------- 初期化 ----------

  function init() {
    $('#paste-note').addEventListener('input', updatePromptPreview);
    $('#paste-copy').addEventListener('click', onCopy);
    $('#paste-load').addEventListener('click', onLoad);
    $('#paste-clear').addEventListener('click', onClearInput);
    $('#photo-file').addEventListener('change', onPhotoFiles);
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMethod(btn.dataset.method));
    });
    setMethod(loadMethod());
    App.onViewChange((view) => {
      // 一覧などで問題が増減したら「登録済み」の表示を更新する
      if (view === 'ai') render();
    });
    updatePromptPreview();
    render();
  }

  init();
})();
