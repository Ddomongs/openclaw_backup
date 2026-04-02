(() => {
  const APP_ID = 'ddomongi-talk-automation';
  const STYLE_ID = 'ddomongi-talk-automation-style';
  const DEFAULT_BASE_URL = 'https://webhook.tipoasis.com';
  const STORAGE_KEY = 'ddomongiNavertalkAutomationSettings';

  if (window.top !== window.self) return;
  if (!shouldRunOnCurrentPage()) return;

  const state = {
    mode: detectMode(),
    settings: {
      baseUrl: DEFAULT_BASE_URL,
      viewerToken: '',
      autoOpenThreshold: 70,
    },
    candidates: [],
    matchResults: [],
    popupDetail: null,
    popupLinkedCard: null,
    localApprovalPreview: null,
    loading: false,
    lastMessage: '대기 중',
  };

  init().catch((error) => console.error('[Ddomongi Talk]', error));

  async function init() {
    ensureStyles();
    state.settings = await loadSettings();
    ensurePanel();
    if (state.mode === 'popup') {
      state.popupDetail = extractPopupDetail();
      await hydratePopupLinkedCard();
      state.lastMessage = '팝업 정보를 읽었습니다.';
    }
    render();
    observeDom();
  }

  function detectMode() {
    if (location.pathname.includes('/chat/ct/')) return 'popup';
    if (location.pathname.includes('/web/accounts/') || document.querySelector('a[href^="/chat/ct/"]')) return 'list';
    return 'unknown';
  }

  function shouldRunOnCurrentPage() {
    const path = location.pathname || '';
    return /^\/web\/accounts\/\d+\/chat/.test(path) || /^\/chat\/ct\//.test(path);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${APP_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 390px;
        max-height: 82vh;
        overflow: auto;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(0,0,0,.38);
        font-family: -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;
        padding: 14px;
      }
      #${APP_ID} * { box-sizing: border-box; }
      #${APP_ID} .hd { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
      #${APP_ID} .title { font-size:15px; font-weight:700; }
      #${APP_ID} .sub { color:#94a3b8; font-size:12px; margin-top:4px; }
      #${APP_ID} .section { margin-top:10px; padding:12px; background:#111827; border:1px solid #1f2937; border-radius:12px; }
      #${APP_ID} .section h3 { margin:0 0 8px; font-size:13px; }
      #${APP_ID} .row { display:flex; gap:8px; align-items:center; justify-content:space-between; margin-top:8px; }
      #${APP_ID} .stack { display:grid; gap:8px; }
      #${APP_ID} .muted { color:#94a3b8; font-size:12px; }
      #${APP_ID} input, #${APP_ID} textarea {
        width:100%; background:#0b1220; color:#f8fafc; border:1px solid #334155; border-radius:10px; padding:10px 12px; font-size:12px;
      }
      #${APP_ID} textarea { min-height:120px; resize:vertical; }
      #${APP_ID} button {
        border:0; border-radius:10px; padding:8px 10px; cursor:pointer; font-size:12px; font-weight:700;
        background:#2563eb; color:white;
      }
      #${APP_ID} button.secondary { background:#334155; }
      #${APP_ID} button.warn { background:#b45309; }
      #${APP_ID} button.good { background:#047857; }
      #${APP_ID} .pill { display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; border-radius:999px; background:#1e293b; font-size:11px; color:#cbd5e1; }
      #${APP_ID} .item { margin-top:8px; padding:10px; border-radius:12px; background:#020617; border:1px solid #1e293b; }
      #${APP_ID} .item-title { font-size:13px; font-weight:700; }
      #${APP_ID} .item-line { margin-top:6px; font-size:12px; color:#cbd5e1; line-height:1.45; word-break:break-word; }
      #${APP_ID} .score { font-size:18px; font-weight:800; color:#93c5fd; }
      #${APP_ID} .reasons { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      #${APP_ID} .reason { padding:4px 8px; border-radius:999px; background:#1d4ed8; color:#dbeafe; font-size:11px; }
      #${APP_ID} .danger { color:#fca5a5; }
      #${APP_ID} .success { color:#86efac; }
      #${APP_ID} .small-btns { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    let root = document.getElementById(APP_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = APP_ID;
    document.body.appendChild(root);
    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
    root.addEventListener('input', handleInput);
    return root;
  }

  function root() {
    return document.getElementById(APP_ID);
  }

  function observeDom() {
    if (state.mode !== 'popup') return;

    let timer = null;
    const observer = new MutationObserver((mutations) => {
      const panel = root();
      if (panel) {
        const onlyPanelMutations = mutations.every((mutation) => {
          return panel.contains(mutation.target);
        });
        if (onlyPanelMutations) return;
      }

      clearTimeout(timer);
      timer = setTimeout(() => {
        const nextDetail = extractPopupDetail();
        const prev = JSON.stringify(state.popupDetail || {});
        const next = JSON.stringify(nextDetail || {});
        if (prev !== next) {
          state.popupDetail = nextDetail;
          render();
        }
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function handleInput(event) {
    const { target } = event;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target.dataset.setting === 'baseUrl') state.settings.baseUrl = target.value.trim();
    if (target.dataset.setting === 'viewerToken') state.settings.viewerToken = target.value.trim();
    if (target.dataset.setting === 'threshold') state.settings.autoOpenThreshold = Number(target.value || 70);
    if (target.dataset.draft === 'custom') state.popupDetail = { ...(state.popupDetail || {}), draft: target.value };
  }

  function handleChange(event) {
    handleInput(event);
  }

  async function handleClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    try {
      if (action === 'save-settings') {
        await saveSettings(state.settings);
        state.lastMessage = '설정을 저장했습니다.';
      }
      if (action === 'scan-candidates') {
        state.candidates = scanUnreadCandidates();
        state.lastMessage = `후보 ${state.candidates.length}건을 읽었습니다.`;
      }
      if (action === 'run-match') {
        await runMatching();
      }
      if (action === 'open-best') {
        const idx = Number(button.dataset.index);
        openBestCandidate(state.matchResults[idx]);
      }
      if (action === 'save-mapping') {
        const idx = Number(button.dataset.index);
        await saveBestMapping(state.matchResults[idx]);
      }
      if (action === 'copy-draft') {
        const text = state.popupDetail?.draft || '';
        await navigator.clipboard.writeText(text);
        state.lastMessage = 'CS 초안을 복사했습니다.';
      }
      if (action === 'create-approval-preview') {
        await createLocalApprovalPreview();
      }
      if (action === 'refresh-popup') {
        state.popupDetail = extractPopupDetail();
        await hydratePopupLinkedCard();
        state.lastMessage = '팝업 정보를 다시 읽었습니다.';
      }
    } catch (error) {
      console.error('[Ddomongi Talk]', error);
      state.lastMessage = `오류: ${error.message || error}`;
    }

    render();
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return {
      baseUrl: data?.[STORAGE_KEY]?.baseUrl || DEFAULT_BASE_URL,
      viewerToken: data?.[STORAGE_KEY]?.viewerToken || '',
      autoOpenThreshold: Number(data?.[STORAGE_KEY]?.autoOpenThreshold || 70),
    };
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  async function apiFetch(path, options = {}) {
    const baseUrl = (state.settings.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const viewerToken = state.settings.viewerToken || '';
    const tokenQuery = viewerToken ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(viewerToken)}` : '';
    const url = `${baseUrl}${path}${tokenQuery}`;

    const response = await chrome.runtime.sendMessage({
      type: 'apiFetch',
      url,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response?.ok) {
      throw new Error(`API ${response?.status || 0}: ${response?.text || 'request failed'}`);
    }

    return JSON.parse(response.text || '{}');
  }

  function scanUnreadCandidates() {
    const anchors = getCandidateAnchorElements();
    const seen = new Set();
    const items = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (seen.has(href)) continue;
      seen.add(href);

      const unreadText = anchor.querySelector('.badge_alarm')?.textContent?.trim() || '';
      const unreadCount = Number((unreadText.match(/\d+/) || [0])[0]) || 0;
      const displayName = anchor.querySelector('[aria-label="유저명"]')?.textContent?.trim() || anchor.querySelector('.text_name')?.textContent?.trim() || '';
      const timeText = anchor.querySelector('.chat_info_time')?.textContent?.trim() || '';
      const previewText = anchor.querySelector('.text_message')?.textContent?.trim() || '';
      const productName = anchor.querySelector('.chat_info_bottom')?.textContent?.replace('문의 내역처', '').trim() || '';
      const popupPath = href.includes('?') ? href : `${href}?mode=popup`;

      if (!displayName && !previewText && !productName) continue;

      items.push({
        candidateId: href.split('/').pop(),
        href,
        popupPath,
        popupUrl: `https://partner.talk.naver.com${popupPath}`,
        displayName,
        previewText,
        productName,
        unreadCount,
        timeText,
      });
    }

    return items.sort((a, b) => b.unreadCount - a.unreadCount);
  }

  function getCandidateAnchorElements() {
    const docs = getTalkListDocuments();
    const anchors = [];

    for (const doc of docs) {
      anchors.push(...doc.querySelectorAll('a[href^="/chat/ct/"]'));
    }

    return anchors;
  }

  function getTalkListDocuments() {
    const docs = [document];
    const iframes = [...document.querySelectorAll('iframe')];

    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) continue;
        if (iframeDoc.querySelector('a[href^="/chat/ct/"]')) {
          docs.push(iframeDoc);
        }
      } catch (error) {
        console.debug('[Ddomongi Talk] iframe access skipped', error);
      }
    }

    return docs;
  }

  async function runMatching() {
    state.loading = true;
    render();

    if (!state.candidates.length) {
      state.candidates = scanUnreadCandidates();
    }

    const cardsResponse = await apiFetch('/api/cards');
    const cards = (cardsResponse.cards || [])
      .filter((card) => (card.unreadIncomingCount || 0) > 0)
      .slice(0, 10);

    const results = [];
    for (const card of cards) {
      const scored = await apiFetch('/api/match/score', {
        method: 'POST',
        body: {
          userId: card.userId,
          card,
          candidates: state.candidates,
        },
      });
      results.push(scored);
    }

    state.matchResults = results
      .filter((item) => item.bestCandidate)
      .sort((a, b) => (b.bestCandidate?.score || 0) - (a.bestCandidate?.score || 0));

    state.loading = false;
    state.lastMessage = `웹훅 카드 ${state.matchResults.length}건에 대해 후보 매칭을 계산했습니다.`;
  }

  function openBestCandidate(item) {
    const best = item?.bestCandidate?.candidate;
    if (!best?.popupUrl) throw new Error('열 팝업 URL이 없습니다.');
    window.open(best.popupUrl, '_blank', 'noopener');
    state.lastMessage = `팝업을 열었습니다: ${best.displayName || best.candidateId}`;
  }

  async function saveBestMapping(item) {
    const best = item?.bestCandidate?.candidate;
    const userId = item?.userId;
    if (!best || !userId) throw new Error('저장할 후보가 없습니다.');

    await apiFetch(`/api/cards/${encodeURIComponent(userId)}/chat-mapping`, {
      method: 'POST',
      body: {
        candidateId: best.candidateId,
        popupPath: best.popupPath,
        popupUrl: best.popupUrl,
        displayName: best.displayName,
        productName: best.productName,
      },
    });

    state.lastMessage = `채팅방 매핑을 저장했습니다: ${userId} → ${best.candidateId}`;
  }

  async function hydratePopupLinkedCard() {
    if (state.mode !== 'popup') return null;
    const popupPath = location.pathname;
    try {
      const response = await apiFetch(`/api/cards/by-popup?popupPath=${encodeURIComponent(popupPath)}`);
      state.popupLinkedCard = response?.cardSummary || null;
      if (state.popupDetail) {
        state.popupDetail.userId = response?.card?.userId || response?.cardSummary?.userId || '';
      }
      return response;
    } catch (error) {
      console.debug('[Ddomongi Talk] popup linked card not found', error);
      state.popupLinkedCard = null;
      if (state.popupDetail) state.popupDetail.userId = '';
      return null;
    }
  }

  function extractPopupDetail() {
    const lines = document.body.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
    const customerName = firstLineAfter(lines, '고객 아이디') || firstLineAfter(lines, '고객 닉네임') || '';
    const purchaseDate = firstLineAfter(lines, '구매날짜') || '';
    const orderNo = firstLineAfter(lines, '주문번호') || '';
    const purchasePrice = firstLineAfter(lines, '구매가격:') || '';
    const shippingFee = firstLineAfter(lines, '배송비 :') || firstLineAfter(lines, '배송비') || '';
    const claimStatus = findOneOf(lines, ['교환', '반품', '취소']) || '';
    const optionText = lines.find((line) => line.startsWith('옵션 :')) || '';
    const quantityText = lines.find((line) => line.startsWith('주문수량 :')) || '';
    const trackingNo = firstLineAfter(lines, '송장번호') || '';
    const courier = firstLineAfter(lines, '택배사명') || '';
    const productTitle = findLikelyProductTitle(lines);
    const lastCustomerMessage = findLastCustomerMessage(lines);
    const draft = buildDraft({
      customerName,
      purchaseDate,
      orderNo,
      purchasePrice,
      shippingFee,
      claimStatus,
      optionText,
      quantityText,
      trackingNo,
      courier,
      productTitle,
      lastCustomerMessage,
    });

    return {
      popupPath: location.pathname,
      popupUrl: location.href,
      userId: '',
      customerName,
      purchaseDate,
      orderNo,
      purchasePrice,
      shippingFee,
      claimStatus,
      optionText,
      quantityText,
      trackingNo,
      courier,
      productTitle,
      lastCustomerMessage,
      draft,
    };
  }

  async function createLocalApprovalPreview() {
    const detail = state.popupDetail || extractPopupDetail();
    if (!detail) throw new Error('팝업 정보가 없습니다.');

    if (!state.popupLinkedCard) {
      await hydratePopupLinkedCard();
    }

    const linkedUserId = state.popupLinkedCard?.userId || detail.userId || '';
    if (!linkedUserId) {
      throw new Error('연결된 webhook 카드 userId를 찾지 못했습니다. 먼저 리스트에서 매핑 저장을 확인해주세요.');
    }

    const inquiryType = classifyPopupInquiryType(detail);
    const preview = buildLocalApprovalPreview({
      detail,
      linkedUserId,
      inquiryType,
      recentMessages: buildRecentMessagesFromPopup(detail),
    });

    state.localApprovalPreview = preview;
    await navigator.clipboard.writeText(preview.discordMessage);
    state.lastMessage = `로컬 승인 카드 미리보기를 만들고 복사했습니다: ${preview.approvalId}`;
  }

  function buildLocalApprovalPreview({ detail, linkedUserId, inquiryType, recentMessages }) {
    const approvalId = `local_apr_${Date.now().toString(36)}`;
    const preview = {
      approvalId,
      source: 'local-popup-preview',
      channel: 'talktalk',
      inquiryType,
      userId: linkedUserId,
      customerName: detail.customerName || '',
      productName: detail.productTitle || '',
      orderNo: detail.orderNo || '',
      trackingNo: detail.trackingNo || '',
      draft: detail.draft || '',
      recentMessages,
    };

    preview.discordMessage = buildDiscordApprovalPreviewText(preview);
    preview.discordButtons = [
      { customId: `approval:${approvalId}:approve`, label: '승인', style: 'success' },
      { customId: `approval:${approvalId}:hold`, label: '보류', style: 'secondary' },
      { customId: `approval:${approvalId}:revise`, label: '수정요청', style: 'danger' },
    ];
    return preview;
  }

  function buildRecentMessagesFromPopup(detail) {
    const items = [];
    if (detail.lastCustomerMessage) {
      items.push({ label: '고객', text: detail.lastCustomerMessage });
    }
    return items;
  }

  function buildDiscordApprovalPreviewText(preview) {
    const lines = [
      `[${preview.approvalId}] 톡톡 / ${preview.inquiryType} / ${preview.customerName || '고객명 미확인'}`,
    ];
    if (preview.productName) lines.push(`상품: ${preview.productName}`);
    if (preview.orderNo) lines.push(`주문번호: ${preview.orderNo}`);
    if (preview.trackingNo) lines.push(`송장번호: ${preview.trackingNo}`);
    lines.push(`연결 userId: ${preview.userId}`);

    if (preview.recentMessages?.length) {
      lines.push('', '[최근 대화]');
      for (const item of preview.recentMessages) {
        lines.push(`- ${item.label} ${item.text}`);
      }
    }

    if (preview.draft) {
      lines.push('', '[초안]', '```text', preview.draft, '```');
    }

    lines.push('', '버튼:', '승인 / 보류 / 수정요청');
    return lines.join('\n');
  }

  function classifyPopupInquiryType(detail) {
    const text = `${detail?.lastCustomerMessage || ''} ${detail?.claimStatus || ''}`;
    if (/배송|언제|도착|받/.test(text)) return '배송문의';
    if (/환불|반품|교환|취소/.test(text)) return '취소/교환/반품';
    if (/불량|고장|안눌|이상|문제/.test(text)) return '불량/사용문의';
    return '일반문의';
  }

  function firstLineAfter(lines, label) {
    const idx = lines.findIndex((line) => line === label || line.startsWith(label));
    if (idx < 0) return '';
    for (let i = idx + 1; i < Math.min(lines.length, idx + 4); i++) {
      const line = lines[i];
      if (!line || line === label) continue;
      if (isFieldLabel(line)) continue;
      return line;
    }
    return '';
  }

  function isFieldLabel(line) {
    return ['구매날짜', '주문번호', '구매가격:', '배송비 :', '택배사명', '송장번호', '배송방식', '상담정보'].includes(line);
  }

  function findOneOf(lines, values) {
    return lines.find((line) => values.includes(line)) || '';
  }

  function findLikelyProductTitle(lines) {
    const idx = lines.findIndex((line) => line.includes('상품문의'));
    if (idx >= 0) {
      for (let i = idx + 1; i < Math.min(lines.length, idx + 6); i++) {
        const line = lines[i];
        if (line && !line.includes('또몽이네 스토어') && !line.includes('원') && !line.includes('무료배송')) return line;
      }
    }

    const productLine = lines.find((line) => /원$/.test(line) === false && /게임패드|피규어|우산|테슬라|홍련|컨트롤러/.test(line));
    return productLine || '';
  }

  function findLastCustomerMessage(lines) {
    const candidates = lines.filter((line) => /(오전|오후)\s*\d{1,2}:\d{2}$/.test(line) === false)
      .filter((line) => line.length >= 2)
      .filter((line) => !line.includes('읽음'))
      .filter((line) => !line.includes('쇼핑챗봇'))
      .filter((line) => !line.includes('무엇이 궁금하세요?'))
      .filter((line) => !line.startsWith('구매'))
      .filter((line) => !line.startsWith('주문'))
      .filter((line) => !line.startsWith('배송'));
    return candidates[candidates.length - 1] || '';
  }

  function buildDraft(detail) {
    const product = detail.productTitle || '문의 상품';
    const customerText = detail.lastCustomerMessage || '';

    if (/안눌|고장|불량|문제|이상/.test(customerText)) {
      return `[네이버 톡톡]에서 문의하신 "${product}" 관련하여 안내 말씀 드립니다.\n\n말씀 주신 증상은 확인이 필요한 내용이라 현재 사용 환경과 증상을 다시 한번 확인해보고 안내드리겠습니다.\n가능하시다면 문제 증상이 보이는 사진 또는 영상, 사용하신 기기 정보를 함께 보내주시면 더 정확하게 확인하는 데 도움이 됩니다.\n\n확인 후 다시 안내드리겠습니다.`;
    }

    if (detail.trackingNo) {
      return `[네이버 톡톡]에서 문의하신 "${product}" 관련하여 안내 말씀 드립니다.\n\n현재 확인되는 송장 정보는 ${detail.courier || '택배사 확인 필요'} / ${detail.trackingNo} 입니다.\n배송 흐름은 택배사 반영 시점에 따라 조회가 다소 지연될 수 있어 조금만 더 지켜봐 주시면 감사하겠습니다.\n\n추가로 확인이 필요하시면 다시 말씀 부탁드립니다.`;
    }

    if (detail.claimStatus) {
      return `[네이버 톡톡]에서 문의하신 "${product}" 관련하여 안내 말씀 드립니다.\n\n현재 주문 건은 ${detail.claimStatus} 관련 이력이 확인되고 있습니다.\n진행 상태를 다시 점검한 뒤 정확한 내용으로 안내드리겠습니다.\n\n조금만 기다려 주시면 확인 후 다시 말씀드리겠습니다.`;
    }

    return `[네이버 톡톡]에서 문의하신 "${product}" 관련하여 안내 말씀 드립니다.\n\n문의 주신 내용은 확인 후 정확하게 안내드리겠습니다.\n조금만 기다려 주시면 확인 뒤 다시 말씀드리겠습니다.`;
  }

  function render() {
    const el = root();
    if (!el) return;

    if (state.mode === 'list') {
      el.innerHTML = renderListPanel();
      return;
    }

    if (state.mode === 'popup') {
      el.innerHTML = renderPopupPanel();
      return;
    }

    el.innerHTML = `
      <div class="hd"><div><div class="title">또몽이 톡톡 자동화</div><div class="sub">지원되지 않는 페이지입니다.</div></div></div>
    `;
  }

  function renderListPanel() {
    const resultHtml = state.matchResults.slice(0, 8).map((item, index) => {
      const best = item.bestCandidate;
      const candidate = best?.candidate || {};
      const reasons = (best?.reasons || []).map((reason) => `<span class="reason">${escapeHtml(reason)}</span>`).join('');
      return `
        <div class="item">
          <div class="row"><div class="item-title">${escapeHtml(item.userId || '-')}</div><div class="score">${best?.score || 0}</div></div>
          <div class="item-line">후보: ${escapeHtml(candidate.displayName || candidate.candidateId || '-')}</div>
          <div class="item-line">메시지: ${escapeHtml(candidate.previewText || '-')}</div>
          <div class="item-line">상품: ${escapeHtml(candidate.productName || '-')}</div>
          <div class="item-line ${item.ambiguous ? 'danger' : 'success'}">${item.ambiguous ? '후보 불확실 · 팝업 확인 권장' : '유력 후보 · 메시지/시간 일치'}</div>
          <div class="reasons">${reasons}</div>
          <div class="small-btns">
            <button class="secondary" data-action="open-best" data-index="${index}">팝업 열기</button>
            <button class="good" data-action="save-mapping" data-index="${index}">매핑 저장</button>
          </div>
        </div>
      `;
    }).join('');

    const candidateHtml = state.candidates.slice(0, 8).map((candidate) => `
      <div class="item">
        <div class="row"><div class="item-title">${escapeHtml(candidate.displayName || '-')}</div><span class="pill">안읽음 ${candidate.unreadCount}</span></div>
        <div class="item-line">시간: ${escapeHtml(candidate.timeText || '-')}</div>
        <div class="item-line">메시지: ${escapeHtml(candidate.previewText || '-')}</div>
        <div class="item-line">상품: ${escapeHtml(candidate.productName || '-')}</div>
      </div>
    `).join('');

    return `
      <div class="hd">
        <div>
          <div class="title">또몽이 톡톡 자동화</div>
          <div class="sub">상담리스트 후보 수집 / 웹훅 카드 매칭 / 팝업 연결</div>
        </div>
        <span class="pill">리스트</span>
      </div>

      <div class="section stack">
        <h3>설정</h3>
        <label class="muted">Monitor Base URL</label>
        <input data-setting="baseUrl" value="${escapeHtml(state.settings.baseUrl || '')}" />
        <label class="muted">Viewer Token</label>
        <input data-setting="viewerToken" value="${escapeHtml(state.settings.viewerToken || '')}" />
        <label class="muted">자동 오픈 기준 점수</label>
        <input data-setting="threshold" type="number" value="${escapeHtml(String(state.settings.autoOpenThreshold || 70))}" />
        <div class="small-btns"><button data-action="save-settings">설정 저장</button></div>
      </div>

      <div class="section">
        <div class="small-btns">
          <button data-action="scan-candidates">후보 스캔</button>
          <button class="good" data-action="run-match">웹훅 매칭</button>
        </div>
        <div class="item-line">${escapeHtml(state.lastMessage)}</div>
      </div>

      <div class="section">
        <h3>후보 채팅방</h3>
        ${candidateHtml || '<div class="muted">후보를 아직 읽지 않았습니다.</div>'}
      </div>

      <div class="section">
        <h3>매칭 결과</h3>
        ${state.loading ? '<div class="muted">점수 계산 중...</div>' : (resultHtml || '<div class="muted">매칭 결과가 아직 없습니다.</div>')}
      </div>
    `;
  }

  function renderPopupPanel() {
    const detail = state.popupDetail || {};
    return `
      <div class="hd">
        <div>
          <div class="title">또몽이 톡톡 자동화</div>
          <div class="sub">주문정보 추출 / CS 초안 생성</div>
        </div>
        <span class="pill">팝업</span>
      </div>

      <div class="section">
        <div class="small-btns">
          <button data-action="refresh-popup">새로 읽기</button>
          <button class="good" data-action="copy-draft">초안 복사</button>
          <button class="warn" data-action="create-approval-preview">승인 카드 미리보기</button>
        </div>
        <div class="item-line">${escapeHtml(state.lastMessage)}</div>
      </div>

      <div class="section">
        <h3>추출 정보</h3>
        ${renderDetailLine('고객명', detail.customerName)}
        ${renderDetailLine('상품명', detail.productTitle)}
        ${renderDetailLine('구매날짜', detail.purchaseDate)}
        ${renderDetailLine('주문번호', detail.orderNo)}
        ${renderDetailLine('구매가격', detail.purchasePrice)}
        ${renderDetailLine('배송비', detail.shippingFee)}
        ${renderDetailLine('클레임', detail.claimStatus)}
        ${renderDetailLine('옵션', detail.optionText)}
        ${renderDetailLine('수량', detail.quantityText)}
        ${renderDetailLine('택배사', detail.courier)}
        ${renderDetailLine('송장번호', detail.trackingNo)}
        ${renderDetailLine('최근 고객메시지', detail.lastCustomerMessage)}
        ${renderDetailLine('연결 userId', detail.userId || state.popupLinkedCard?.userId)}
        ${renderDetailLine('최근 로컬 승인카드', state.localApprovalPreview?.approvalId)}
      </div>

      <div class="section stack">
        <h3>CS 초안</h3>
        <textarea data-draft="custom">${escapeHtml(detail.draft || '')}</textarea>
      </div>

      <div class="section stack">
        <h3>로컬 승인 카드 미리보기</h3>
        <textarea readonly>${escapeHtml(state.localApprovalPreview?.discordMessage || '')}</textarea>
      </div>
    `;
  }

  function renderDetailLine(label, value) {
    if (!value) return '';
    return `<div class="item-line"><strong>${escapeHtml(label)}</strong> · ${escapeHtml(value)}</div>`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
