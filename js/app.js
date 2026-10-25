(function () {
  'use strict';

  const L = window.MathReviewLogic;
  const STORAGE_KEY = 'math-review.v1';
  const VIEW_KEY = 'math-review.view';

  const RESULT_BUTTONS = {
    // 未判定・× のとき
    initial: [
      { result: 'wrong', label: '× 解けなかった', cls: 'wrong' },
      { result: 'solved', label: '○ 解けた', cls: 'ok' },
    ],
    ok: [
      { result: 'wrong', label: '× 解けなかった', cls: 'wrong' },
      { result: 'solved', label: '解けたが要点はすぐ出なかった', cls: 'neutral' },
      { result: 'quick', label: '要点をすぐ答えられた', cls: 'mastered' },
    ],
    mastered: [
      { result: 'wrong', label: '× 解けなかった', cls: 'wrong' },
      { result: 'solved', label: '要点はすぐ出なかった（○に戻す）', cls: 'neutral' },
      { result: 'quick', label: '要点をすぐ答えられた', cls: 'mastered' },
    ],
  };

  let problems = load();
  let currentView = 'review';
  let editingId = null;
  // 「編集して追加」で開いた AI の候補が追加されたときに呼ぶ
  let draftOnAdded = null;
  const viewListeners = [];
  // 復習画面の状態
  const review = {
    skipped: [], // 「あとで」にした問題 ID（このページを開いている間だけ）
    forcedId: null, // 一覧から「今すぐ復習」を選んだ問題
    currentId: null,
    revealed: false,
  };

  const $ = (sel) => document.querySelector(sel);

  // ---------- 保存 ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.problems) ? data.problems.map(L.normalize) : [];
    } catch (e) {
      console.error(e);
      alert('保存データを読み込めませんでした。');
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, problems }));
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました。ブラウザの保存容量や設定を確認してください。');
    }
  }

  function findProblem(id) {
    return problems.find((p) => p.id === id) || null;
  }

  function replaceProblem(updated) {
    problems = problems.map((p) => (p.id === updated.id ? updated : p));
    save();
  }

  // ---------- 表示の補助 ----------

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function renderMath(node) {
    if (typeof window.renderMathInElement !== 'function') return;
    window.renderMathInElement(node, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }

  // 数式を含むテキストのブロック（HTML としては解釈しない）
  function mathBlock(text, cls) {
    const node = el('div', { class: `math-text ${cls || ''}` }, text);
    renderMath(node);
    return node;
  }

  function statusBadge(p) {
    return el('span', { class: `status status-${p.status}` }, L.STATUS_LABEL[p.status]);
  }

  function quickProgress(p) {
    if (p.status !== 'ok') return null;
    return el('span', { class: 'quick-progress' }, `要点即答 ${p.quickCount}/${L.MASTERY_THRESHOLD}`);
  }

  function formatDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
    return `${m}/${d}（${wd}）`;
  }

  function dueLabel(p) {
    const diff = L.overdueDays(p, new Date());
    if (diff > 0) return `復習予定を${diff}日過ぎています`;
    if (diff === 0) return '今日が復習日';
    if (diff === -1) return '明日復習';
    return `次回 ${formatDateKey(L.dueDateKey(p))}（${-diff}日後）`;
  }

  let toastTimer = null;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 2800);
  }

  // ---------- 画面切り替え ----------

  function showView(view) {
    currentView = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch (e) {
      /* 表示中のタブを覚えられなくても動作には影響しない */
    }
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.view === view));
    });
    document.querySelectorAll('.view').forEach((section) => {
      section.hidden = section.id !== `view-${view}`;
    });
    render();
    viewListeners.forEach((fn) => fn(view));
  }

  function render() {
    renderBadge();
    if (currentView === 'review') renderReview();
    if (currentView === 'list') renderList();
    if (currentView === 'form') renderSourceOptions();
  }

  function renderBadge() {
    const count = L.dueProblems(problems, new Date()).length;
    const badge = $('#due-badge');
    badge.hidden = count === 0;
    badge.textContent = count;
  }

  // ---------- 復習 ----------

  function renderStats() {
    const counts = { unrated: 0, wrong: 0, ok: 0, mastered: 0 };
    problems.forEach((p) => counts[p.status]++);
    const box = $('#stats');
    box.replaceChildren(
      ...L.STATUSES.map((s) =>
        el('div', { class: 'stat' },
          el('span', { class: `status status-${s}` }, L.STATUS_LABEL[s]),
          el('span', { class: 'stat-num' }, counts[s]),
        ),
      ),
    );
  }

  function pickCurrent(due) {
    if (review.forcedId && findProblem(review.forcedId)) return findProblem(review.forcedId);
    review.forcedId = null;
    // 表示中の問題は判定するまで入れ替えない
    const shown = due.find((p) => p.id === review.currentId);
    if (shown) return shown;
    const ids = new Set(due.map((p) => p.id));
    review.skipped = review.skipped.filter((id) => ids.has(id));
    const fresh = due.filter((p) => !review.skipped.includes(p.id));
    if (fresh.length > 0) return fresh[0];
    if (review.skipped.length > 0) {
      // あとで回しにしたものだけが残ったら、その順に出し直す
      const id = review.skipped.shift();
      return findProblem(id);
    }
    return null;
  }

  function renderReview() {
    renderStats();
    const area = $('#review-area');
    const now = new Date();
    const due = L.dueProblems(problems, now);

    if (problems.length === 0) {
      area.replaceChildren(
        el('div', { class: 'card empty' },
          el('p', {}, 'まだ問題が登録されていません。'),
          el('button', { class: 'btn primary', onclick: () => showView('ai') }, 'AIで問題を追加する'),
        ),
      );
      return;
    }

    const current = pickCurrent(due);
    if (!current) {
      review.currentId = null;
      const next = L.nextUpcoming(problems, now);
      area.replaceChildren(
        el('div', { class: 'card empty' },
          el('p', { class: 'done' }, '今日復習すべき問題はありません。'),
          next ? el('p', { class: 'muted' }, `次の復習: ${formatDateKey(next.dateKey)} に ${next.count}問`) : null,
        ),
      );
      return;
    }

    if (review.currentId !== current.id) {
      review.currentId = current.id;
      review.revealed = false;
    }

    const isForced = review.forcedId === current.id;
    const remaining = due.filter((p) => p.id !== current.id).length;
    const header = el('div', { class: 'review-meta' },
      el('span', {}, isForced ? '一覧から選んだ問題' : `今日の復習 残り ${remaining + 1}問`),
    );

    area.replaceChildren(header, reviewCard(current));
  }

  function reviewCard(p) {
    const buttons =
      p.status === 'ok' ? RESULT_BUTTONS.ok : p.status === 'mastered' ? RESULT_BUTTONS.mastered : RESULT_BUTTONS.initial;

    const question =
      p.status === 'ok' || p.status === 'mastered'
        ? 'この問題の要点をすぐに答えられますか？ 頭の中で答えてから確認してください。'
        : 'この問題を解いてから、要点を確認してください。';

    const card = el('article', { class: 'card review-card' },
      el('div', { class: 'card-head' },
        statusBadge(p),
        quickProgress(p),
        p.source ? el('span', { class: 'source' }, p.source) : null,
      ),
      mathBlock(p.text, 'problem-text'),
      el('p', { class: 'prompt' }, question),
    );

    if (!review.revealed) {
      card.append(
        el('div', { class: 'actions' },
          el('button', {
            class: 'btn primary',
            onclick: () => {
              review.revealed = true;
              renderReview();
            },
          }, '要点を確認する'),
          review.forcedId === p.id
            ? el('button', { class: 'btn', onclick: () => { review.forcedId = null; showView('list'); } }, 'やめる')
            : el('button', { class: 'btn', onclick: () => skip(p.id) }, 'あとで'),
        ),
      );
      return card;
    }

    card.append(
      el('div', { class: 'keypoint' },
        el('div', { class: 'keypoint-label' }, '要点'),
        p.keypoint ? mathBlock(p.keypoint) : el('p', { class: 'muted' }, '要点は登録されていません。編集画面から追加できます。'),
      ),
      el('p', { class: 'prompt' }, '自己判定してください'),
      el('div', { class: 'actions result-actions' },
        buttons.map((b) =>
          el('button', { class: `btn result ${b.cls}`, onclick: () => submitReview(p.id, b.result) }, b.label),
        ),
      ),
    );
    return card;
  }

  function skip(id) {
    review.skipped = review.skipped.filter((x) => x !== id).concat(id);
    review.currentId = null;
    renderReview();
  }

  function submitReview(id, result) {
    const p = findProblem(id);
    if (!p) return;
    const updated = L.applyReview(p, result, new Date());
    replaceProblem(updated);
    if (review.forcedId === id) review.forcedId = null;
    review.skipped = review.skipped.filter((x) => x !== id);
    review.currentId = null;

    const from = L.STATUS_LABEL[p.status];
    const to = L.STATUS_LABEL[updated.status];
    let message;
    if (p.status === 'ok' && updated.status === 'mastered') {
      message = `${L.MASTERY_THRESHOLD}回目の即答で ◎ になりました`;
    } else if (from !== to) {
      message = `${from} → ${to}`;
    } else if (updated.status === 'ok' && result === 'quick') {
      message = `要点即答 ${updated.quickCount}/${L.MASTERY_THRESHOLD}`;
    } else {
      message = `${to} のまま`;
    }
    toast(`${message}（次回 ${formatDateKey(L.dueDateKey(updated))}）`);
    render();
  }

  // ---------- 一覧 ----------

  function renderList() {
    const query = $('#list-search').value.trim().toLowerCase();
    const status = $('#list-status').value;
    const sort = $('#list-sort').value;

    let items = problems.filter((p) => {
      if (status && p.status !== status) return false;
      if (!query) return true;
      return [p.text, p.source, p.keypoint].some((s) => s.toLowerCase().includes(query));
    });

    const sorters = {
      due: (a, b) => L.dueDateKey(a).localeCompare(L.dueDateKey(b)) || a.createdAt.localeCompare(b.createdAt),
      'created-desc': (a, b) => b.createdAt.localeCompare(a.createdAt),
      'created-asc': (a, b) => a.createdAt.localeCompare(b.createdAt),
      source: (a, b) => a.source.localeCompare(b.source, 'ja') || a.createdAt.localeCompare(b.createdAt),
    };
    items = items.slice().sort(sorters[sort]);

    $('#list-count').textContent = `${items.length}問 / 全${problems.length}問`;

    const list = $('#problem-list');
    if (items.length === 0) {
      list.replaceChildren(el('li', { class: 'card empty' }, problems.length === 0 ? 'まだ問題がありません。' : '該当する問題がありません。'));
      return;
    }

    list.replaceChildren(
      ...items.map((p) => {
        const due = L.isDue(p, new Date());
        return el('li', { class: 'card problem-item' },
          el('div', { class: 'card-head' },
            statusBadge(p),
            quickProgress(p),
            p.source ? el('span', { class: 'source' }, p.source) : el('span', { class: 'source muted' }, '出典なし'),
          ),
          mathBlock(p.text, 'problem-text clamp'),
          el('div', { class: 'item-foot' },
            el('span', { class: due ? 'due-label due' : 'due-label' }, dueLabel(p)),
            el('div', { class: 'item-actions' },
              el('button', { class: 'btn small', onclick: () => startReviewOf(p.id) }, '今すぐ復習'),
              el('button', { class: 'btn small', onclick: () => openForm(p.id) }, '編集'),
              el('button', { class: 'btn small danger', onclick: () => removeProblem(p.id) }, '削除'),
            ),
          ),
        );
      }),
    );
  }

  function startReviewOf(id) {
    review.forcedId = id;
    review.currentId = null;
    showView('review');
  }

  function removeProblem(id) {
    const p = findProblem(id);
    if (!p) return;
    const head = p.text.length > 40 ? `${p.text.slice(0, 40)}…` : p.text;
    if (!confirm(`この問題を削除しますか？\n\n${head}`)) return;
    problems = problems.filter((x) => x.id !== id);
    save();
    toast('削除しました');
    render();
  }

  // ---------- 追加・編集 ----------

  function renderSourceOptions() {
    const sources = [...new Set(problems.map((p) => p.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    $('#source-options').replaceChildren(...sources.map((s) => el('option', { value: s })));
  }

  function updatePreview() {
    const text = $('#f-text').value;
    const box = $('#f-text-preview');
    box.hidden = text.trim() === '';
    box.replaceChildren(el('div', { class: 'preview-label' }, 'プレビュー'), mathBlock(text, 'problem-text'));
  }

  function updateStatusHint() {
    const status = $('#f-status').value;
    const p = editingId ? findProblem(editingId) : null;
    let hint = '';
    if (p && status !== p.status) {
      hint = '状況を変更すると、今日判定したものとして次回の復習日を計算し直します。';
      if (p.status === 'ok') hint += `（要点即答の回数 ${p.quickCount} はリセットされます）`;
    } else if (p && p.status === 'ok') {
      hint = `要点即答 ${p.quickCount}/${L.MASTERY_THRESHOLD}`;
    } else if (!p && status !== 'unrated') {
      hint = '今日判定したものとして次回の復習日を決めます。';
    }
    $('#f-status-hint').textContent = hint;
  }

  function fillForm(p) {
    $('#form-title').textContent = p ? '問題を編集' : 'AI の候補を編集して追加';
    $('#f-submit').textContent = p ? '保存する' : '追加する';
    $('#f-text').value = p ? p.text : '';
    $('#f-source').value = p ? p.source : '';
    $('#f-keypoint').value = p ? p.keypoint : '';
    $('#f-status').value = p ? p.status : 'unrated';
    updatePreview();
    updateStatusHint();
  }

  function openForm(id) {
    editingId = id;
    draftOnAdded = null;
    fillForm(findProblem(id));
    showView('form');
    $('#f-text').focus();
  }

  function submitForm(event) {
    event.preventDefault();
    const fields = {
      text: $('#f-text').value.trim(),
      source: $('#f-source').value.trim(),
      keypoint: $('#f-keypoint').value.trim(),
      status: $('#f-status').value,
    };
    if (!fields.text) {
      $('#f-text').focus();
      return;
    }

    const now = new Date();
    if (editingId) {
      const p = findProblem(editingId);
      if (!p) return;
      let updated = { ...p, text: fields.text, source: fields.source, keypoint: fields.keypoint, updatedAt: now.toISOString() };
      updated = L.setStatusManually(updated, fields.status, now);
      replaceProblem(updated);
      toast('保存しました');
      editingId = null;
      fillForm(null);
      showView('list');
    } else {
      const p = L.createProblem(fields, now);
      problems = problems.concat(p);
      save();
      if (draftOnAdded) draftOnAdded(p);
      draftOnAdded = null;
      toast('追加しました');
      fillForm(null);
      showView('ai');
    }
  }

  // AI の候補を、内容を入れた状態の追加フォームで開く
  function openDraft(fields, onAdded) {
    editingId = null;
    draftOnAdded = onAdded || null;
    fillForm(null);
    $('#f-text').value = fields.text || '';
    $('#f-source').value = fields.source || '';
    $('#f-keypoint').value = fields.keypoint || '';
    updatePreview();
    showView('form');
    $('#f-text').focus();
  }

  function addProblem(fields) {
    const p = L.createProblem({ ...fields, status: 'unrated' }, new Date());
    problems = problems.concat(p);
    save();
    renderBadge();
    return p;
  }

  function hasProblemText(text) {
    const t = text.trim();
    return problems.some((p) => p.text.trim() === t);
  }

  function cancelEdit() {
    const back = editingId ? 'list' : 'ai';
    editingId = null;
    draftOnAdded = null;
    fillForm(null);
    showView(back);
  }

  // ---------- データ ----------

  function exportData() {
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), problems }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = el('a', { href: url, download: `math-review-${L.toDateKey(new Date())}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : data.problems;
        if (!Array.isArray(list)) throw new Error('problems がありません');
        imported = list.map(L.normalize);
      } catch (e) {
        alert(`読み込めませんでした: ${e.message}`);
        return;
      }
      if (!confirm(`${imported.length}問を読み込み、現在の${problems.length}問と置き換えます。よろしいですか？`)) return;
      problems = imported;
      save();
      review.skipped = [];
      review.forcedId = null;
      review.currentId = null;
      toast(`${imported.length}問を読み込みました`);
      render();
    };
    reader.readAsText(file);
  }

  // ---------- 初期化 ----------

  function init() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    $('#list-search').addEventListener('input', renderList);
    $('#list-status').addEventListener('change', renderList);
    $('#list-sort').addEventListener('change', renderList);
    $('#problem-form').addEventListener('submit', submitForm);
    $('#f-cancel').addEventListener('click', cancelEdit);
    $('#f-text').addEventListener('input', updatePreview);
    $('#f-status').addEventListener('change', updateStatusHint);
    $('#export-btn').addEventListener('click', exportData);
    $('#import-file').addEventListener('change', importData);

    // 別のタブで編集されたら読み込み直す
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      problems = load();
      render();
    });

    let initialView = 'review';
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (['review', 'list', 'ai', 'data'].includes(saved)) initialView = saved;
    } catch (e) {
      /* 既定の画面で開く */
    }
    fillForm(null);
    showView(initialView);
  }

  // 「AIで追加」画面（js/ai-import.js）から使う
  window.MathReviewApp = {
    el,
    mathBlock,
    toast,
    addProblem,
    hasProblemText,
    openDraft,
    onViewChange: (fn) => viewListeners.push(fn),
  };

  init();
})();
