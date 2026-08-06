(() => {
  "use strict";

  const SYSTEM_ONE_API = "https://kkk.ow800.com/api/cards/verify";
  const SYSTEM_TWO_API = "https://czgpt.plus/api/v1/kami/status";
  const HANDOFF_KEY = "aivip:auto-card-handoff:v1";
  const REQUEST_TIMEOUT = 20_000;
  const REDIRECT_DELAY = 650;
  const SYSTEM_ONE_PRODUCTS = new Set([3, 10]);
  const SYSTEM_TWO_PREFIXES = [
    "G20X",
    "G05X",
    "CP",
    "GK",
    "XP",
    "YC",
    "TM",
    "TK",
    "TH",
    "KM",
  ];

  const elements = {
    form: document.querySelector("#auto-card-form"),
    input: document.querySelector("#auto-card-code"),
    submit: document.querySelector("#auto-card-submit"),
    error: document.querySelector("#auto-card-error"),
    notice: document.querySelector("#auto-card-notice"),
    noticeTitle: document.querySelector("#auto-card-notice-title"),
    noticeDetail: document.querySelector("#auto-card-notice-detail"),
    navRecharge: document.querySelector("#auto-nav-recharge"),
    navQuery: document.querySelector("#auto-nav-query"),
    queryDialog: document.querySelector("#auto-query-dialog"),
    queryClose: document.querySelector("#auto-query-close"),
    queryForm: document.querySelector("#auto-query-form"),
    queryInput: document.querySelector("#auto-query-code"),
    querySubmit: document.querySelector("#auto-query-submit"),
    queryError: document.querySelector("#auto-query-error"),
    queryNotice: document.querySelector("#auto-query-notice"),
    queryNoticeTitle: document.querySelector("#auto-query-notice-title"),
    queryNoticeDetail: document.querySelector("#auto-query-notice-detail"),
  };

  const flows = {
    verify: {
      input: elements.input,
      submit: elements.submit,
      error: elements.error,
      notice: elements.notice,
      noticeTitle: elements.noticeTitle,
      noticeDetail: elements.noticeDetail,
      defaultLabel: "验证卡密",
    },
    query: {
      input: elements.queryInput,
      submit: elements.querySubmit,
      error: elements.queryError,
      notice: elements.queryNotice,
      noticeTitle: elements.queryNoticeTitle,
      noticeDetail: elements.queryNoticeDetail,
      defaultLabel: "查询卡密",
    },
  };

  let activeController = null;

  function normalizeCard(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function setLoading(action, loading) {
    const flow = flows[action];
    const label = flow.submit.querySelector("span:first-child");
    flow.submit.classList.toggle("is-loading", loading);
    flow.submit.disabled = loading;
    flow.input.disabled = loading;
    label.textContent = loading ? "正在识别" : flow.defaultLabel;
    if (action === "query") {
      elements.queryClose.disabled = loading;
    }
  }

  function setError(action, message) {
    const flow = flows[action];
    flow.input.setAttribute("aria-invalid", message ? "true" : "false");
    flow.error.textContent = message || "";
  }

  function showNotice(action, type, title, detail) {
    const flow = flows[action];
    flow.notice.hidden = false;
    flow.notice.className = `notice${action === "query" ? " auto-query-notice" : ""} is-${type}`;
    flow.noticeTitle.textContent = title;
    flow.noticeDetail.textContent = detail;
  }

  function hideNotice(action) {
    const flow = flows[action];
    flow.notice.hidden = true;
    flow.notice.className = `notice${action === "query" ? " auto-query-notice" : ""}`;
    flow.noticeTitle.textContent = "";
    flow.noticeDetail.textContent = "";
  }

  function unwrapSystemOne(payload) {
    let current = payload;
    for (let depth = 0; depth < 4 && isObject(current); depth += 1) {
      const hasEnvelope =
        Object.prototype.hasOwnProperty.call(current, "data") &&
        ("code" in current || "success" in current || "error" in current);
      if (!hasEnvelope) {
        break;
      }
      current = current.data;
    }
    return isObject(current) ? current : {};
  }

  async function request(url, options, signal) {
    const response = await fetch(url, {
      ...options,
      signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error("invalid-response");
    }
    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }
    return payload;
  }

  async function checkSystemOne(card, signal) {
    const payload = await request(
      SYSTEM_ONE_API,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardInfo: card }),
      },
      signal,
    );
    const data = unwrapSystemOne(payload);
    const productId = Number(data.productId ?? data.product_id);

    if (Number.isInteger(productId) && productId > 0) {
      return SYSTEM_ONE_PRODUCTS.has(productId) ? 1 : 2;
    }
    return null;
  }

  async function checkSystemTwo(card, signal) {
    const payload = await request(
      SYSTEM_TWO_API,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        body: card,
      },
      signal,
    );
    if (Array.isArray(payload) && payload.length === 0) {
      return null;
    }
    if (!Array.isArray(payload) || payload.length !== 1 || !isObject(payload[0])) {
      throw new Error("invalid-response");
    }
    const result = payload[0];
    const responseCard = normalizeCard(result.code);
    const status = String(result.status || "").trim().toLowerCase();
    const type = String(result.type || "").trim();

    if (responseCard !== card) {
      throw new Error("mismatched-response");
    }
    if (status === "not_found") {
      return null;
    }
    return status && type ? 2 : null;
  }

  function localTestSystem(card) {
    const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!localHost) {
      return null;
    }
    if (card.startsWith("LOCALTEST1")) {
      return 1;
    }
    if (card.startsWith("LOCALTEST2")) {
      return 2;
    }
    if (card.startsWith("LOCALTEST0")) {
      return 0;
    }
    return null;
  }

  async function identifySystem(card, signal) {
    const testSystem = localTestSystem(card);
    if (testSystem !== null) {
      return testSystem || null;
    }

    const prefersSystemTwo = SYSTEM_TWO_PREFIXES.some((prefix) => card.startsWith(prefix));
    const checks = prefersSystemTwo
      ? [checkSystemTwo, checkSystemOne]
      : [checkSystemOne, checkSystemTwo];
    let connectionFailures = 0;

    for (const check of checks) {
      try {
        const system = await check(card, signal);
        if (system) {
          return system;
        }
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw error;
        }
        connectionFailures += 1;
      }
    }

    if (connectionFailures > 0) {
      throw new Error("service-unavailable");
    }
    return null;
  }

  function saveHandoff(card, system, action) {
    const handoff = {
      card,
      system,
      action,
      createdAt: Date.now(),
    };
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  }

  function destinationFor(system) {
    const destination = new URL(
      system === 1 ? "./1/" : "./2/",
      window.location.href,
    );
    destination.searchParams.set("entry", "total");
    if (system === 2) {
      destination.searchParams.set("channel", "2");
    }
    destination.searchParams.set("handoff", "1");
    return destination;
  }

  async function handleSubmit(event, action) {
    event.preventDefault();
    const flow = flows[action];
    const card = normalizeCard(flow.input.value);
    let redirecting = false;
    flow.input.value = card;

    if (card.length < 4) {
      setError(action, "请输入完整卡密。");
      flow.input.focus();
      return;
    }

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    setError(action, "");
    hideNotice(action);
    setLoading(action, true);
    showNotice(
      action,
      "warning",
      action === "query" ? "正在识别卡密" : "正在验证卡密",
      "请稍候…",
    );

    try {
      const system = await identifySystem(card, controller.signal);
      if (!system) {
        showNotice(
          action,
          "error",
          action === "query" ? "未找到卡密" : "卡密验证未通过",
          "卡密无效或暂无法识别，请检查卡密或切换网络后重试。",
        );
        return;
      }

      try {
        saveHandoff(card, system, action);
      } catch {
        showNotice(action, "error", "暂时无法继续", "请检查浏览器设置后刷新页面重试。");
        return;
      }

      showNotice(
        action,
        "success",
        action === "query" ? "识别成功" : "验证成功",
        action === "query" ? "正在打开对应的卡密查询…" : "正在进入充值页面…",
      );
      redirecting = true;
      window.setTimeout(() => {
        window.location.assign(destinationFor(system).href);
      }, REDIRECT_DELAY);
    } catch (error) {
      if (error && error.name === "AbortError") {
        showNotice(action, "warning", "卡密识别超时", "请检查网络后重试。");
      } else {
        showNotice(action, "warning", "暂时无法识别", "请检查网络后重试。");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (!redirecting) {
        setLoading(action, false);
      }
      if (activeController === controller) {
        activeController = null;
      }
    }
  }

  function handleInput(action) {
    const flow = flows[action];
    const normalized = normalizeCard(flow.input.value);
    if (flow.input.value !== normalized) {
      flow.input.value = normalized;
    }
    setError(action, "");
    hideNotice(action);
  }

  function openQueryDialog() {
    if (activeController || elements.queryDialog.open) {
      return;
    }
    elements.queryForm.reset();
    setError("query", "");
    hideNotice("query");
    setLoading("query", false);
    elements.queryDialog.showModal();
    window.setTimeout(() => elements.queryInput.focus(), 0);
  }

  function closeQueryDialog() {
    if (!activeController && elements.queryDialog.open) {
      elements.queryDialog.close();
    }
  }

  elements.input.addEventListener("input", () => handleInput("verify"));
  elements.queryInput.addEventListener("input", () => handleInput("query"));
  elements.form.addEventListener("submit", (event) => handleSubmit(event, "verify"));
  elements.queryForm.addEventListener("submit", (event) => handleSubmit(event, "query"));
  elements.navRecharge.addEventListener("click", (event) => {
    if (activeController) {
      event.preventDefault();
    }
  });
  elements.navQuery.addEventListener("click", () => {
    openQueryDialog();
  });
  elements.queryClose.addEventListener("click", closeQueryDialog);
  elements.queryDialog.addEventListener("cancel", (event) => {
    if (activeController) {
      event.preventDefault();
    }
  });
  window.addEventListener("pagehide", () => activeController?.abort(), { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      activeController = null;
      setLoading("verify", false);
      setLoading("query", false);
      hideNotice("verify");
      hideNotice("query");
      closeQueryDialog();
    }
  });
  setLoading("verify", false);
  setLoading("query", false);
  setError("verify", "");
  setError("query", "");
  hideNotice("verify");
  hideNotice("query");
})();
