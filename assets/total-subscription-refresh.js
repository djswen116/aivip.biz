(() => {
  "use strict";

  const REFRESH_API = "https://kkk.ow800.com/api/cards/refresh-subscription";
  const REQUEST_TIMEOUT = 30_000;
  const SESSION_LIMIT = 200_000;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const elements = {
    open: $("#auto-nav-refresh"),
    backdrop: $("#subscription-refresh-backdrop"),
    dialog: $("#subscription-refresh-dialog"),
    close: $("#subscription-refresh-close"),
    form: $("#subscription-refresh-form"),
    session: $("#subscription-refresh-session"),
    count: $("#subscription-refresh-count"),
    error: $("#subscription-refresh-error"),
    submit: $("#subscription-refresh-submit"),
    submitSpinner: $("#subscription-refresh-submit-spinner"),
    submitLabel: $("#subscription-refresh-submit-label"),
    clear: $("#subscription-refresh-clear"),
    status: $("#subscription-refresh-status"),
    empty: $("#subscription-refresh-empty"),
    loadingSpinner: $("#subscription-refresh-loading-spinner"),
    stateSymbol: $("#subscription-refresh-state-symbol"),
    stateTitle: $("#subscription-refresh-state-title"),
    stateDetail: $("#subscription-refresh-state-detail"),
    tableWrap: $("#subscription-refresh-table-wrap"),
    resultEmail: $("#subscription-refresh-email"),
    resultTag: $("#subscription-refresh-result-tag"),
    resultTime: $("#subscription-refresh-time"),
    resultMessage: $("#subscription-refresh-message"),
  };

  if (Object.values(elements).some((element) => !element)) {
    return;
  }

  const state = {
    busy: false,
    controller: null,
    lastFocused: null,
    previousBodyOverflow: "",
  };

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function completeSessionRoot(parsed) {
    if (isObject(parsed.session)) {
      return parsed.session;
    }
    if (isObject(parsed.data) && isObject(parsed.data.session)) {
      return parsed.data.session;
    }
    if (
      isObject(parsed.data) &&
      (isObject(parsed.data.user) || typeof parsed.data.accessToken === "string")
    ) {
      return parsed.data;
    }
    return parsed;
  }

  function decodeJwtSection(section) {
    try {
      const padded = section
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(section.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function inspectAccessToken(value) {
    const token = String(value || "").trim();
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)) ||
      !parts[0].startsWith("eyJ")
    ) {
      throw new Error("Session 中的 accessToken 不是完整的三段式 JWT。");
    }
    const header = decodeJwtSection(parts[0]);
    const payload = decodeJwtSection(parts[1]);
    if (!header || !payload || !Object.keys(payload).length) {
      throw new Error("Session 中的 accessToken 已损坏或内容无法解析。");
    }
    if (payload.exp !== undefined) {
      const expiresAt = Number(payload.exp);
      if (!Number.isFinite(expiresAt)) {
        throw new Error("Session 中的 accessToken 过期时间格式异常。");
      }
      if (expiresAt <= Date.now() / 1000) {
        throw new Error("Session 中的 accessToken 已过期，请重新获取 Session。");
      }
    }
    return payload;
  }

  function sessionExpiryTimestamp(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return Number.NaN;
      }
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    return Date.parse(String(value));
  }

  function uniqueEmails(values) {
    const unique = new Map();
    values.forEach((value) => {
      const email = String(value || "").trim();
      const key = email.toLowerCase();
      if (email && !unique.has(key)) {
        unique.set(key, email);
      }
    });
    return [...unique.values()];
  }

  function authoritativeTokenEmails(payload) {
    const user = isObject(payload.user) ? payload.user : {};
    const profile = isObject(payload.profile) ? payload.profile : {};
    const openAiProfile = isObject(payload["https://api.openai.com/profile"])
      ? payload["https://api.openai.com/profile"]
      : {};
    return [payload.email, user.email, profile.email, openAiProfile.email].filter(validEmail);
  }

  function extractSession(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      throw new Error("请先粘贴完整的 Session JSON。");
    }
    if (raw.length > SESSION_LIMIT) {
      throw new Error("输入内容过大，请检查后重试。");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("JSON 格式不完整，请复制完整内容后重试。");
    }
    if (!isObject(parsed)) {
      throw new Error("输入内容必须是一个 JSON 对象。");
    }

    const sessionRoot = completeSessionRoot(parsed);
    if (typeof sessionRoot.accessToken !== "string" || !sessionRoot.accessToken.trim()) {
      throw new Error("缺少 accessToken 字段。");
    }
    const tokenPayload = inspectAccessToken(sessionRoot.accessToken);
    const user = isObject(sessionRoot.user) ? sessionRoot.user : null;
    const email = String(user?.email || "").trim();
    if (!validEmail(email)) {
      throw new Error("缺少有效的 user.email 账户信息。");
    }
    if (uniqueEmails([email, ...authoritativeTokenEmails(tokenPayload)]).length > 1) {
      throw new Error("Session 与 AccessToken 中的邮箱不一致，请重新获取 Session。");
    }
    if (!sessionRoot.WARNING_BANNER && !parsed.WARNING_BANNER) {
      throw new Error("缺少 WARNING_BANNER 安全提示字段。");
    }

    const expiresValue =
      sessionRoot.expires !== undefined ? sessionRoot.expires : parsed.expires;
    const expiresAt = sessionExpiryTimestamp(expiresValue);
    if (Number.isNaN(expiresAt)) {
      throw new Error("Session 的 expires 过期时间格式异常，请重新获取 Session。");
    }
    if (expiresAt !== null && expiresAt <= Date.now()) {
      throw new Error("Session 已过期，请重新登录 ChatGPT 后获取新的 Session。");
    }
    return { email, fullSession: raw };
  }

  function formatRefreshTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  function sanitizeMessage(value, fallback) {
    const text = String(value || "").trim();
    if (!text) {
      return fallback;
    }
    const sanitized = text
      .replace(
        /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
        "[凭证已隐藏]",
      )
      .replace(/"accessToken"\s*:\s*"[^"]+"/gi, '"accessToken":"[已隐藏]"');
    return sanitized.length > 180 ? `${sanitized.slice(0, 180)}…` : sanitized;
  }

  function failureMessage(message, status) {
    const normalized = String(message || "").trim().toLowerCase();
    if (/token|session|invalid|expired|失效|无效|过期/.test(normalized)) {
      return "Session 无效或已过期，请重新获取后再试。";
    }
    if (/rate|频繁|too many/.test(normalized) || status === 429) {
      return "请求过于频繁，请稍后再试。";
    }
    if (/timeout|超时/.test(normalized) || status === 504) {
      return "服务处理超时，请稍后确认订阅状态。";
    }
    if (status === 401 || status === 403) {
      return "接口未授权当前请求，请联系客服协助。";
    }
    return "刷新未完成，请稍后重试。";
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.session.disabled = busy;
    elements.submit.disabled = busy;
    elements.clear.disabled = busy;
    elements.submitSpinner.hidden = !busy;
    elements.submitLabel.textContent = busy ? "正在刷新" : "校验并刷新";
  }

  function syncCount() {
    elements.count.textContent = `${elements.session.value.length} 字符`;
  }

  function setStatus(kind, label) {
    elements.status.className =
      kind === "idle"
        ? "refresh-status-pill"
        : `refresh-status-pill refresh-status-${kind}`;
    elements.status.textContent = label;
  }

  function showEmpty(options = {}) {
    const kind = options.kind || "idle";
    elements.tableWrap.hidden = true;
    elements.empty.hidden = false;
    elements.empty.className =
      kind === "error" ? "refresh-state-message refresh-state-error" : "refresh-state-message";
    elements.loadingSpinner.hidden = kind !== "loading";
    elements.stateSymbol.hidden = kind === "loading";
    elements.stateSymbol.textContent = kind === "error" ? "!" : "↻";
    elements.stateTitle.textContent =
      options.title || "等待刷新，请粘贴完整Session后提交刷新";
    elements.stateDetail.textContent = options.detail || "";
    setStatus(kind, options.statusLabel || "等待输入");
  }

  function showResult(result) {
    elements.empty.hidden = true;
    elements.tableWrap.hidden = false;
    elements.resultEmail.textContent = result.email;
    elements.resultTag.className = `refresh-result-tag refresh-result-tag-${result.tone}`;
    elements.resultTag.textContent = result.statusLabel;
    elements.resultTime.textContent = result.refreshedAt;
    elements.resultMessage.textContent = result.message;
    setStatus(result.tone, result.tone === "success" ? "1 条记录" : result.statusLabel);
  }

  function reset(options = {}) {
    elements.error.textContent = "";
    elements.session.removeAttribute("aria-invalid");
    if (options.clearInput !== false) {
      elements.session.value = "";
      syncCount();
    }
    showEmpty();
  }

  function closeQueryDialogIfIdle() {
    const queryDialog = $("#auto-query-dialog");
    const querySubmit = $("#auto-query-submit");
    if (!(queryDialog instanceof HTMLDialogElement) || !queryDialog.open) {
      return true;
    }
    if (querySubmit?.classList.contains("is-loading")) {
      return false;
    }
    queryDialog.close();
    return true;
  }

  function openDialog() {
    if (state.busy || !elements.backdrop.hidden || !closeQueryDialogIfIdle()) {
      return;
    }
    state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elements.backdrop.hidden = false;
    window.setTimeout(() => elements.session.focus(), 0);
  }

  function closeDialog() {
    state.controller?.abort();
    state.controller = null;
    setBusy(false);
    elements.backdrop.hidden = true;
    reset();
    document.body.style.overflow = state.previousBodyOverflow;
    const previous = state.lastFocused;
    state.lastFocused = null;
    if (previous?.isConnected) {
      window.setTimeout(() => previous.focus(), 0);
    }
  }

  function handleKeydown(event) {
    if (elements.backdrop.hidden) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = $$(
      '[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      elements.dialog,
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.busy) {
      return;
    }

    let validated;
    try {
      validated = extractSession(elements.session.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Session 校验失败。";
      elements.error.textContent = message;
      elements.session.setAttribute("aria-invalid", "true");
      showEmpty({
        kind: "error",
        statusLabel: "格式错误",
        title: "输入内容未通过校验",
        detail: message,
      });
      elements.session.focus();
      return;
    }

    const controller = new AbortController();
    state.controller = controller;
    let timedOut = false;
    let responseStarted = false;
    const requestBody = { token: validated.fullSession };
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT);

    elements.error.textContent = "";
    elements.session.removeAttribute("aria-invalid");
    setBusy(true);
    showEmpty({
      kind: "loading",
      statusLabel: "处理中",
      title: "正在同步订阅",
      detail: "请求已安全提交，请勿关闭页面。最长等待约 30 秒。",
    });

    try {
      const response = await fetch(REFRESH_API, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      responseStarted = true;
      const responseText = await response.text();
      let parsed = {};
      let parsedJson = true;
      try {
        parsed = responseText ? JSON.parse(responseText) : {};
      } catch {
        parsedJson = false;
      }

      const root = isObject(parsed) ? parsed : {};
      const levelOne = isObject(root.data) ? root.data : root;
      const levelTwo = isObject(levelOne.data) ? levelOne.data : levelOne;
      const success =
        typeof levelTwo.success === "boolean"
          ? levelTwo.success
          : typeof levelOne.success === "boolean"
            ? levelOne.success
            : typeof root.success === "boolean"
              ? root.success
              : null;
      const message =
        typeof levelTwo.message === "string"
          ? levelTwo.message
          : typeof levelOne.message === "string"
            ? levelOne.message
            : typeof root.message === "string"
              ? root.message
              : "";
      const codeFailed = root.code !== undefined && Number(root.code) !== 200;
      const succeeded = response.ok && !codeFailed && success === true;
      const fallback = succeeded ? "刷新成功" : failureMessage(message, response.status);
      const safeMessage = sanitizeMessage(
        message || (parsedJson ? "" : responseText),
        fallback,
      );

      showResult({
        email: validated.email,
        statusLabel: succeeded ? "刷新成功" : "刷新失败",
        refreshedAt: formatRefreshTime(),
        message: safeMessage,
        tone: succeeded ? "success" : "error",
      });
      if (succeeded) {
        elements.session.value = "";
        syncCount();
      }
    } catch (error) {
      if (controller.signal.aborted && !timedOut) {
        return;
      }
      const networkFailure =
        !responseStarted && error instanceof Error && /fetch|network|load failed/i.test(error.message);
      const message = timedOut
        ? "请求在 30 秒内未返回；服务器端可能仍已完成，请先核对订阅状态。"
        : networkFailure
          ? "未收到接口响应，请检查网络、HTTPS 或跨域设置。"
          : "刷新未完成，请稍后重试。";
      showResult({
        email: validated.email,
        statusLabel: timedOut ? "结果未知" : "刷新失败",
        refreshedAt: formatRefreshTime(),
        message: sanitizeMessage(message, "刷新未完成，请稍后重试。"),
        tone: timedOut ? "unknown" : "error",
      });
    } finally {
      window.clearTimeout(timeoutId);
      requestBody.token = "";
      validated.fullSession = "";
      if (state.controller === controller) {
        state.controller = null;
      }
      setBusy(false);
    }
  }

  elements.open.addEventListener("click", openDialog);
  elements.close.addEventListener("click", closeDialog);
  elements.backdrop.addEventListener("mousedown", (event) => {
    if (event.target === elements.backdrop) {
      closeDialog();
    }
  });
  elements.session.addEventListener("input", () => {
    syncCount();
    if (!state.busy) {
      elements.error.textContent = "";
      elements.session.removeAttribute("aria-invalid");
      showEmpty();
    }
  });
  elements.clear.addEventListener("click", () => {
    if (!state.busy) {
      reset();
      elements.session.focus();
    }
  });
  elements.form.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener(
    "pagehide",
    () => {
      state.controller?.abort();
      state.controller = null;
      elements.session.value = "";
    },
    { once: true },
  );

  reset();
})();
