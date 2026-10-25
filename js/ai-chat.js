/*
 * AI チャットで問題を追加する画面
 * Claude API（Anthropic 公式 SDK）をブラウザから直接呼び出す。API キーは利用者のもの。
 */
(function () {
  'use strict';

  const App = window.MathReviewApp;
  const SETTINGS_KEY = 'math-review.ai';
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  // Claude Haiku 5.5 にはサーバー側のフォールバックがない
  const MODELS_WITH_FALLBACK = ['claude-opus-5-5', 'claude-sonnet-5-5'];
  const MAX_IMAGES = 5;
  const MAX_IMAGE_EDGE = 1568;

  const SYSTEM_PROMPT = `あなたは数学の復習ノートアプリに組み込まれたアシスタントです。ユーザーが送る文章や問題の写真をもとに、復習用に登録する問題を作るのを手伝います。

応答は指定された JSON 形式で返します。
- message: ユーザーへの返事（日本語で簡潔に）。読み取れなかった箇所や確認したいことがあればここに書く。
- problems: 登録候補の問題。候補が無いやりとり（質問への回答など）では空配列にする。

各問題の項目:
- text: 問題文。原文に忠実に書き起こす。数式は KaTeX で表示できる LaTeX にし、文中は $...$、別行は $$...$$ で囲む。小問は (1) (2) のように改行して並べる。図がある問題は、解くのに必要な図の情報を文章で補う。
- source: 出典（書名と問題番号、大学名・年度・大問番号など）。ユーザーが示したものか、画像から読み取れるものだけを書き、推測で作らない。分からなければ空文字にする。
- keypoint: 復習のときに「要点をすぐに答えられるか」を確かめるための要点。解法の方針や鍵になる発想を1〜2文で書く。最終的な答えの値だけにはしない。

ユーザーが候補の修正を求めたら、修正後の候補を problems に入れて返す（修正していない問題は含めなくてよい）。ユーザーが問題を言葉で説明した場合も、問題文として整えて候補にする。`;

  const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
      message: { type: 'string' },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            source: { type: 'string' },
            keypoint: { type: 'string' },
          },
          required: ['text', 'source', 'keypoint'],
          additionalProperties: false,
        },
      },
    },
    required: ['message', 'problems'],
    additionalProperties: false,
  };

  const { el, mathBlock, toast } = App;
  const $ = (sel) => document.querySelector(sel);

  // API に送る会話（追記のみ。応答の content はそのまま戻す）
  let apiMessages = [];
  // 画面に表示する会話
  let displayItems = [];
  let pendingImages = [];
  let busy = false;

  // ---------- 設定 ----------

  function loadSettings() {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
        model: MODELS.includes(data.model) ? data.model : DEFAULT_MODEL,
      };
    } catch (e) {
      return { apiKey: '', model: DEFAULT_MODEL };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      alert('設定を保存できませんでした。ブラウザの設定を確認してください。');
      return false;
    }
  }

  function fillSettingsForm() {
    const settings = loadSettings();
    $('#ai-key').value = settings.apiKey;
    $('#ai-model').value = settings.model;
    $('#ai-settings').open = !settings.apiKey;
  }

  function onSaveSettings() {
    const apiKey = $('#ai-key').value.trim();
    if (saveSettings({ apiKey, model: $('#ai-model').value })) {
      toast(apiKey ? '設定を保存しました' : 'API キーが空のままです');
      if (apiKey) $('#ai-settings').open = false;
      renderLog();
    }
  }

  function onClearKey() {
    if (!confirm('保存した API キーをこのブラウザから削除しますか？')) return;
    saveSettings({ apiKey: '', model: $('#ai-model').value });
    $('#ai-key').value = '';
    toast('API キーを削除しました');
    renderLog();
  }

  // ---------- 画像 ----------

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        // 大きすぎる写真は縮小して送る（送信量と料金を抑える）
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`${file.name || '画像'} を読み込めませんでした`));
      };
      img.src = url;
    });
  }

  async function addImages(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    for (const file of images) {
      if (pendingImages.length >= MAX_IMAGES) {
        toast(`画像は1回に${MAX_IMAGES}枚までです`);
        break;
      }
      try {
        pendingImages.push(await readImage(file));
      } catch (e) {
        toast(e.message);
      }
    }
    renderAttachments();
  }

  function renderAttachments() {
    $('#chat-attachments').replaceChildren(
      ...pendingImages.map((img, i) =>
        el('div', { class: 'attachment' },
          el('img', { src: img.url, alt: `添付画像 ${i + 1}` }),
          el('button', {
            type: 'button',
            class: 'attachment-remove',
            'aria-label': '添付を外す',
            onclick: () => {
              pendingImages.splice(i, 1);
              renderAttachments();
            },
          }, '×'),
        ),
      ),
    );
  }

  // ---------- 表示 ----------

  function proposalCard(item, proposal) {
    const f = proposal.fields;
    const duplicate = !proposal.addedId && App.hasProblemText(f.text);
    return el('div', { class: `proposal ${proposal.addedId ? 'added' : ''}` },
      mathBlock(f.text, 'problem-text'),
      el('div', { class: 'proposal-meta' },
        el('span', { class: 'proposal-label' }, '出典'),
        f.source ? el('span', {}, f.source) : el('span', { class: 'muted' }, '（なし）'),
      ),
      el('div', { class: 'proposal-meta' },
        el('span', { class: 'proposal-label' }, '要点'),
        f.keypoint ? mathBlock(f.keypoint) : el('span', { class: 'muted' }, '（なし）'),
      ),
      duplicate ? el('p', { class: 'warn' }, '同じ問題文がすでに登録されています。') : null,
      proposal.addedId
        ? el('p', { class: 'added-label' }, '追加しました（未判定）')
        : el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn primary small', onclick: () => addProposal(proposal) }, '追加'),
          el('button', { type: 'button', class: 'btn small', onclick: () => App.openDraft(f) }, '編集して追加'),
        ),
    );
  }

  function renderItem(item) {
    if (item.role === 'user') {
      return el('div', { class: 'bubble user' },
        item.images.length
          ? el('div', { class: 'bubble-images' }, item.images.map((url) => el('img', { src: url, alt: '送った画像' })))
          : null,
        item.text ? el('div', { class: 'math-text' }, item.text) : null,
      );
    }
    if (item.role === 'error') {
      return el('div', { class: 'bubble error' }, item.text);
    }
    const remaining = item.proposals.filter((p) => !p.addedId);
    return el('div', { class: 'bubble assistant' },
      item.message ? mathBlock(item.message) : null,
      item.proposals.length
        ? el('div', { class: 'proposals' },
          item.proposals.map((p) => proposalCard(item, p)),
          remaining.length > 1
            ? el('button', {
              type: 'button',
              class: 'btn small',
              onclick: () => remaining.forEach(addProposal),
            }, `残りの${remaining.length}問をすべて追加`)
            : null,
        )
        : null,
    );
  }

  function renderLog() {
    const log = $('#chat-log');
    const hasKey = Boolean(loadSettings().apiKey);
    const children = [];

    if (displayItems.length === 0) {
      children.push(
        el('div', { class: 'card chat-intro' },
          el('p', {}, '問題の写真や文章を送ると、AI が問題文（数式つき）・出典・要点を書き起こして登録候補を作ります。内容を確認してから「追加」を押してください。'),
          el('ul', {},
            el('li', {}, '例:「青チャート数学I・A 例題12 です」と書いて問題の写真を添付する'),
            el('li', {}, '例:「次の問題を追加して: 1から100までの整数のうち…」'),
            el('li', {}, '例:「要点をもっと短くして」「出典を 2023年 東大 第3問 にして」'),
          ),
          el('p', { class: 'muted' }, 'AI が書いた問題文や要点には誤りが含まれることがあります。必ず確認してください。'),
          hasKey ? null : el('p', { class: 'warn' }, '使い始めるには、上の「AI の設定」で Anthropic の API キーを入力してください。'),
        ),
      );
    }
    children.push(...displayItems.map(renderItem));
    if (busy) children.push(el('div', { class: 'bubble assistant thinking' }, '考えています…'));

    log.replaceChildren(...children);
    $('#chat-send').disabled = busy;
    log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function addProposal(proposal) {
    if (proposal.addedId) return;
    proposal.addedId = App.addProblem(proposal.fields).id;
    toast('追加しました');
    renderLog();
  }

  // ---------- 送信 ----------

  function errorMessage(err) {
    const A = window.AnthropicSDK.default;
    if (err instanceof A.AuthenticationError) return 'API キーが正しくありません。「AI の設定」を確認してください。';
    if (err instanceof A.PermissionDeniedError) return 'この API キーでは選んだモデルを使えません。';
    if (err instanceof A.RateLimitError) return '利用の上限に達しました。少し待ってからもう一度送ってください。';
    if (err instanceof A.BadRequestError) return `リクエストが受け付けられませんでした: ${err.message}`;
    if (err instanceof A.APIConnectionError) return '通信できませんでした。ネットワークを確認してください。';
    if (err instanceof A.APIError) return `API エラー（${err.status}）: ${err.message}`;
    return `エラー: ${err.message}`;
  }

  function parseReply(response) {
    if (response.stop_reason === 'refusal') {
      throw new Error('この内容には応答できませんでした。言い方や画像を変えて試してください。');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('応答が長くなりすぎて途中で切れました。問題を分けて送ってください。');
    }
    const textBlock = response.content.filter((b) => b.type === 'text').pop();
    if (!textBlock) throw new Error('AI から応答がありませんでした。');
    let data;
    try {
      data = JSON.parse(textBlock.text);
    } catch (e) {
      throw new Error('AI の応答を読み取れませんでした。もう一度送ってください。');
    }
    const problems = Array.isArray(data.problems) ? data.problems : [];
    return {
      message: typeof data.message === 'string' ? data.message : '',
      problems: problems
        .filter((p) => p && typeof p.text === 'string' && p.text.trim())
        .map((p) => ({
          text: p.text.trim(),
          source: typeof p.source === 'string' ? p.source.trim() : '',
          keypoint: typeof p.keypoint === 'string' ? p.keypoint.trim() : '',
        })),
    };
  }

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const settings = loadSettings();
    if (!settings.apiKey) {
      $('#ai-settings').open = true;
      $('#ai-key').focus();
      toast('先に API キーを入力してください');
      return;
    }
    if (!window.AnthropicSDK) {
      toast('AI 機能を読み込めませんでした。ページを再読み込みしてください。');
      return;
    }
    const text = $('#chat-input').value.trim();
    const images = pendingImages;
    if (!text && images.length === 0) return;

    const content = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    }));
    content.push({ type: 'text', text: text || 'この画像の問題を登録したいです。' });

    apiMessages.push({ role: 'user', content });
    const userItem = { role: 'user', text, images: images.map((img) => img.url) };
    displayItems.push(userItem);
    $('#chat-input').value = '';
    pendingImages = [];
    renderAttachments();
    busy = true;
    renderLog();

    try {
      const client = new window.AnthropicSDK.default({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
      const params = {
        model: settings.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: apiMessages,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
        },
      };
      if (MODELS_WITH_FALLBACK.includes(settings.model)) {
        // 安全上の理由で断られたときは、サーバー側で別のモデルに切り替えて再実行する
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }
      const response = await client.beta.messages.create(params);
      const reply = parseReply(response);
      apiMessages.push({ role: 'assistant', content: response.content });
      displayItems.push({
        role: 'assistant',
        message: reply.message,
        proposals: reply.problems.map((fields) => ({ fields, addedId: null })),
      });
    } catch (err) {
      console.error(err);
      // 失敗した発言は会話から外し、入力欄に戻して送り直せるようにする
      apiMessages.pop();
      displayItems.splice(displayItems.indexOf(userItem), 1);
      $('#chat-input').value = text;
      pendingImages = images;
      renderAttachments();
      displayItems.push({ role: 'error', text: errorMessage(err) });
    } finally {
      busy = false;
      renderLog();
    }
  }

  function resetChat() {
    if (busy) return;
    if (displayItems.length && !confirm('会話を消して新しく始めますか？（追加済みの問題は残ります）')) return;
    apiMessages = [];
    displayItems = [];
    pendingImages = [];
    renderAttachments();
    renderLog();
  }

  // ---------- 初期化 ----------

  function init() {
    fillSettingsForm();
    $('#ai-save').addEventListener('click', onSaveSettings);
    $('#ai-clear-key').addEventListener('click', onClearKey);
    $('#chat-form').addEventListener('submit', send);
    $('#chat-reset').addEventListener('click', resetChat);
    $('#chat-file').addEventListener('change', (event) => {
      addImages(event.target.files);
      event.target.value = '';
    });
    $('#chat-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        $('#chat-form').requestSubmit();
      }
    });
    $('#chat-input').addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (files.some((f) => f.type.startsWith('image/'))) addImages(files);
    });
    App.onViewChange((view) => {
      if (view === 'chat') renderLog();
    });
    renderLog();
  }

  init();
})();
