/*
 * 習得状況と復習スケジュールの計算（UI に依存しない純粋な関数群）
 * ブラウザでは window.MathReviewLogic、Node では module.exports として使う。
 */
(function (root) {
  'use strict';

  const STATUSES = ['unrated', 'wrong', 'ok', 'mastered'];

  const STATUS_LABEL = {
    unrated: '未判定',
    wrong: '×',
    ok: '○',
    mastered: '◎',
  };

  // ○ の状態で要点を即答できた回数がこの値に達したら ◎ に昇格する
  const MASTERY_THRESHOLD = 3;

  // 最後に復習した日から次の復習までの日数
  // ○ は要点即答の回数（0, 1, 2 回）に応じて間隔を伸ばす
  const INTERVAL_DAYS = {
    unrated: 0,
    wrong: 1,
    ok: [3, 7, 14],
    mastered: 30,
  };

  // 復習リストでの並び順（小さいほど先）
  const PRIORITY = { wrong: 0, unrated: 1, ok: 2, mastered: 3 };

  // 自己判定の結果
  //   wrong  : 解けなかった
  //   solved : 解けた（要点はすぐには出なかった）
  //   quick  : 要点をすぐに答えられた
  const RESULTS = ['wrong', 'solved', 'quick'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // ローカル時刻での日付キー（YYYY-MM-DD）
  function toDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDaysToKey(key, days) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + days);
    return toDateKey(d);
  }

  function daysBetweenKeys(fromKey, toKey) {
    const [y1, m1, d1] = fromKey.split('-').map(Number);
    const [y2, m2, d2] = toKey.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }

  function generateId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // 保存データの欠けた項目を補い、不正な値を既定値に戻す
  function normalize(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const now = new Date().toISOString();
    const status = STATUSES.includes(p.status) ? p.status : 'unrated';
    const quickCount = Number.isInteger(p.quickCount) && p.quickCount > 0 ? p.quickCount : 0;
    return {
      id: typeof p.id === 'string' && p.id ? p.id : generateId(),
      text: typeof p.text === 'string' ? p.text : '',
      source: typeof p.source === 'string' ? p.source : '',
      // 問題の写真（js/image-store.js に保存した写真の ID）
      images: Array.isArray(p.images) ? p.images.filter((id) => typeof id === 'string' && id) : [],
      status,
      quickCount: status === 'ok' ? quickCount : 0,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
      lastReviewedAt: typeof p.lastReviewedAt === 'string' ? p.lastReviewedAt : null,
      history: Array.isArray(p.history) ? p.history : [],
    };
  }

  function createProblem(fields, now) {
    const at = (now || new Date()).toISOString();
    const status = STATUSES.includes(fields.status) ? fields.status : 'unrated';
    return {
      id: generateId(),
      text: fields.text || '',
      source: fields.source || '',
      images: Array.isArray(fields.images) ? fields.images.slice() : [],
      status,
      quickCount: 0,
      createdAt: at,
      updatedAt: at,
      // 登録時に未判定以外を選んだ場合は、その日に判定したものとして扱う
      lastReviewedAt: status === 'unrated' ? null : at,
      history: status === 'unrated' ? [] : [{ at, type: 'manual', from: 'unrated', to: status }],
    };
  }

  function intervalDays(p) {
    if (p.status === 'ok') {
      const steps = INTERVAL_DAYS.ok;
      return steps[Math.min(p.quickCount, steps.length - 1)];
    }
    return INTERVAL_DAYS[p.status];
  }

  function dueDateKey(p) {
    const base = toDateKey(p.lastReviewedAt || p.createdAt);
    return addDaysToKey(base, intervalDays(p));
  }

  function isDue(p, now) {
    return dueDateKey(p) <= toDateKey(now || new Date());
  }

  // 正なら予定日を過ぎた日数、負なら予定日までの日数
  function overdueDays(p, now) {
    return daysBetweenKeys(dueDateKey(p), toDateKey(now || new Date()));
  }

  function compareForReview(a, b) {
    return (
      PRIORITY[a.status] - PRIORITY[b.status] ||
      dueDateKey(a).localeCompare(dueDateKey(b)) ||
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  function dueProblems(list, now) {
    return list.filter((p) => isDue(p, now)).sort(compareForReview);
  }

  // まだ期限が来ていない問題のうち、最も早い復習日とその日の問題数
  function nextUpcoming(list, now) {
    const keys = list.filter((p) => !isDue(p, now)).map(dueDateKey).sort();
    if (keys.length === 0) return null;
    return { dateKey: keys[0], count: keys.filter((k) => k === keys[0]).length };
  }

  // 自己判定の結果を反映した新しい問題オブジェクトを返す
  function applyReview(p, result, now) {
    if (!RESULTS.includes(result)) throw new Error(`unknown result: ${result}`);
    const at = (now || new Date()).toISOString();
    const from = p.status;
    let status = p.status;
    let quickCount = p.quickCount;

    if (result === 'wrong') {
      status = 'wrong';
      quickCount = 0;
    } else if (from === 'unrated' || from === 'wrong') {
      // 未判定・× から解けた場合はまず ○ にする（即答の回数は ○ になってから数える）
      status = 'ok';
      quickCount = 0;
    } else if (from === 'ok') {
      if (result === 'quick') {
        quickCount += 1;
        if (quickCount >= MASTERY_THRESHOLD) {
          status = 'mastered';
          quickCount = 0;
        }
      }
    } else if (from === 'mastered') {
      if (result === 'solved') {
        // 要点がすぐに出なかったら ○ に戻して数え直す
        status = 'ok';
        quickCount = 0;
      }
    }

    const entry = { at, type: 'review', result, from, to: status };
    if (status === 'ok') entry.quickCount = quickCount;

    return {
      ...p,
      status,
      quickCount,
      lastReviewedAt: at,
      updatedAt: at,
      history: [...p.history, entry],
    };
  }

  // 編集画面から習得状況を直接変更する
  function setStatusManually(p, status, now) {
    if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
    if (status === p.status) return p;
    const at = (now || new Date()).toISOString();
    return {
      ...p,
      status,
      quickCount: 0,
      lastReviewedAt: at,
      updatedAt: at,
      history: [...p.history, { at, type: 'manual', from: p.status, to: status }],
    };
  }

  const api = {
    STATUSES,
    STATUS_LABEL,
    MASTERY_THRESHOLD,
    INTERVAL_DAYS,
    RESULTS,
    toDateKey,
    addDaysToKey,
    daysBetweenKeys,
    normalize,
    createProblem,
    intervalDays,
    dueDateKey,
    isDue,
    overdueDays,
    dueProblems,
    nextUpcoming,
    applyReview,
    setStatusManually,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MathReviewLogic = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
