(() => {
  "use strict";

  const API_BASE = "https://kkk.ow800.com";
  const SUPPORTED_PRODUCT_IDS = new Set([3, 10]);
  const REQUEST_TIMEOUT = 45_000;
  const SUBMIT_TIMEOUT = 180_000;
  const REFRESH_TIMEOUT = 30_000;
  const REFRESH_SESSION_LIMIT = 200_000;
  const POLL_INTERVAL = 4_500;
  const POLL_LIMIT = 15 * 60_000;
  const TIMELINE = ["提交充值请求", "等待通道处理", "充值完成"];

  const ERROR_COPY = Object.freeze({
    3001: {
      title: "这张卡正在处理中",
      detail: "检测到卡密已有未结束任务。请稍后用原卡密查询状态，不要再次提交充值。",
    },
    4008: {
      title: "通道正在维护",
      detail: "当前充值通道暂不可用。请稍后查询卡密状态，再决定是否重新操作。",
    },
    4009: {
      title: "账户状态异常",
      detail: "目标账户未通过通道检查。请核对账户状态，必要时联系客服协助。",
    },
    4010: {
      title: "当前库存不足",
      detail: "通道暂无可用库存。卡密是否已消耗请以查询结果为准。",
    },
    4011: {
      title: "充值未完成",
      detail: "通道返回充值失败。请保留当前页面信息，并先用原卡密查询状态。",
    },
    404: {
      title: "任务不存在或已过期",
      detail: "没有找到对应任务。请改用原卡密查询，或联系客服处理。",
    },
  });

  const SERVICE_ERROR_COPY = Object.freeze({
    CARD_ALREADY_USED: {
      title: "卡密已使用",
      detail: "如有异常，刷新订阅或联系客服。",
    },
  });
  const SERVICE_STATUS_MESSAGES = new Set(["CARD_VERIFICATION_SUCCESS"]);

  const CARD_STATUS_COPY = Object.freeze({
    unused: { label: "未使用", tone: "success" },
    used: { label: "已使用", tone: "warning" },
    processing: { label: "正在处理", tone: "info" },
    failed: { label: "处理失败", tone: "error" },
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const elements = {
    systemSwitcher: $("[data-system-switcher]"),
    systemSwitcherCurrent: $("#system-switcher-current"),
    systemSwitcherLinkLabel: $("#system-switcher-link-label"),
    systemSwitcherNotice: $("#system-switcher-notice"),
    systemSwitcherNoticeTitle: $("#system-switcher-notice-title"),
    workspace: $(".workspace"),
    cardForm: $("#card-form"),
    cardInput: $("#card-code"),
    cardError: $("#card-error"),
    verifyButton: $("#verify-card-button"),
    accountStage: $('[data-stage="account"]'),
    taskStage: $('[data-stage="task"]'),
    accountForm: $("#account-form"),
    credentialInput: $("#gpt-credential"),
    credentialError: $("#gpt-error"),
    confirmedAccountSummary: $("#confirmed-account-summary"),
    confirmedAccountEmail: $("#confirmed-account-email"),
    reopenAccountConfirm: $("#reopen-account-confirm"),
    accountConfirmDialog: $("#account-confirm-dialog"),
    accountConfirmCancel: $("#account-confirm-cancel"),
    accountConfirmCheckbox: $("#account-confirm-checkbox"),
    accountConfirmSubmit: $("#account-confirm-submit"),
    accountConfirmEmail: $("#account-confirm-email"),
    accountConfirmPlan: $("#account-confirm-plan"),
    accountMembershipNotice: $("#account-membership-notice"),
    forceRecharge: $("#force-recharge"),
    verifiedProductCopy: $("#verified-product-copy"),
    submitButton: $("#submit-recharge-button"),
    backToCard: $("#back-to-card"),
    notice: $("#main-notice"),
    noticeTitle: $("#notice-title"),
    noticeDetail: $("#notice-detail"),
    noticeBackend: $("#notice-backend"),
    noticeAction: $("#notice-action"),
    taskTitle: $("#task-title"),
    taskSummary: $("#task-summary"),
    taskStatusPill: $("#task-status-pill"),
    taskProgress: $("#task-progress"),
    taskTimeline: $("#task-timeline"),
    taskCard: $("#task-card"),
    taskEmail: $("#task-email"),
    taskUpdated: $("#task-updated"),
    stopPolling: $("#stop-polling"),
    startOver: $("#start-over"),
    recoveryDialog: $("#recovery-dialog"),
    recoveryClose: $(".query-dialog-close", $("#recovery-dialog")),
    recoveryForm: $("#recovery-form"),
    recoveryValue: $("#recovery-value"),
    recoveryError: $("#recovery-error"),
    recoverySubmit: $("#recovery-submit"),
    recoveryResult: $("#recovery-result"),
    recoveryResultMessage: $("#recovery-result-message"),
    recoveryResultIndicator: $(".query-result-message > span", $("#recovery-result")),
    recoveryResultTitle: $("#recovery-result-title"),
    recoveryResultDetail: $("#recovery-result-detail"),
    recoveryResultHeading: $("#recovery-result-heading"),
    recoveryResultStatus: $("#recovery-result-status"),
    recoveryResultGrid: $("#recovery-result-grid"),
    recoveryResultStatusValue: $("#recovery-result-status-value"),
    recoveryResultEmail: $("#recovery-result-email"),
    recoveryResultUsedAt: $("#recovery-result-used-at"),
    openRefresh: $("#open-subscription-refresh"),
    refreshBackdrop: $("#subscription-refresh-backdrop"),
    refreshDialog: $("#subscription-refresh-dialog"),
    refreshClose: $("#subscription-refresh-close"),
    refreshForm: $("#subscription-refresh-form"),
    refreshSession: $("#subscription-refresh-session"),
    refreshCount: $("#subscription-refresh-count"),
    refreshError: $("#subscription-refresh-error"),
    refreshSubmit: $("#subscription-refresh-submit"),
    refreshSubmitSpinner: $("#subscription-refresh-submit-spinner"),
    refreshSubmitLabel: $("#subscription-refresh-submit-label"),
    refreshClear: $("#subscription-refresh-clear"),
    refreshStatus: $("#subscription-refresh-status"),
    refreshEmpty: $("#subscription-refresh-empty"),
    refreshLoadingSpinner: $("#subscription-refresh-loading-spinner"),
    refreshStateSymbol: $("#subscription-refresh-state-symbol"),
    refreshStateTitle: $("#subscription-refresh-state-title"),
    refreshStateDetail: $("#subscription-refresh-state-detail"),
    refreshTableWrap: $("#subscription-refresh-table-wrap"),
    refreshResultEmail: $("#subscription-refresh-email"),
    refreshResultTag: $("#subscription-refresh-result-tag"),
    refreshResultTime: $("#subscription-refresh-time"),
    refreshResultMessage: $("#subscription-refresh-message"),
  };

  const state = {
    verified: null,
    taskId: "",
    phase: "idle",
    locked: false,
    runId: 0,
    controllers: new Set(),
    pollTimer: null,
    resolveDelay: null,
    userStopped: false,
    recoveryBusy: false,
    refreshBusy: false,
    refreshController: null,
    refreshPreviousBodyOverflow: "",
    refreshLastFocused: null,
    recoveryCandidate: null,
    confirmedEmail: "",
    confirmedPlanType: "",
    confirmedRevision: -1,
    credentialRevision: 0,
    credentialConfirmTimer: null,
    pendingAccountConfirmation: null,
    forceRechargeAutoChecked: false,
  };

  class RequestTimeoutError extends Error {
    constructor() {
      super("request-timeout");
      this.name = "RequestTimeoutError";
    }
  }

  function syncSystemSwitcherContext() {
    const currentSystem = Number(elements.systemSwitcher?.dataset.currentSystem);
    const defaultSystem = Number(elements.systemSwitcher?.dataset.defaultSystem);
    const targetSystem = Number(
      elements.systemSwitcher?.querySelector("[data-target-system]")?.dataset.targetSystem,
    );

    if (!currentSystem || !defaultSystem) {
      return;
    }

    const isDefault = currentSystem === defaultSystem;
    elements.systemSwitcherCurrent.textContent = isDefault
      ? `当前默认：AI 充值系统${currentSystem}`
      : `当前：AI 充值系统${currentSystem}`;
    elements.systemSwitcherLinkLabel.textContent = isDefault
      ? `切换到系统${targetSystem}`
      : `返回默认系统${defaultSystem}`;
    elements.systemSwitcherNoticeTitle.textContent =
      `现使用 AI 充值系统${currentSystem}，当前默认系统为 AI 充值系统${defaultSystem}`;
    elements.systemSwitcherNotice.hidden = isDefault;
  }

  class NetworkRequestError extends Error {
    constructor() {
      super("network-request-failed");
      this.name = "NetworkRequestError";
    }
  }

  class OperationCanceledError extends Error {
    constructor() {
      super("operation-canceled");
      this.name = "OperationCanceledError";
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function asText(value) {
    return typeof value === "string" ? value : "";
  }

  function asTaskId(value) {
    if (typeof value === "string" || typeof value === "number") {
      return String(value).trim();
    }
    return "";
  }

  function normalizeCard(value) {
    return String(value || "").trim();
  }

  function isSupportedProductId(value) {
    return SUPPORTED_PRODUCT_IDS.has(Number(value));
  }

  function normalizeQueryCard(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function collectRecordCandidates(root, nestedKeys) {
    if (!isObject(root)) {
      return [];
    }

    const records = [];
    const queue = [root];
    const seen = new Set();

    while (queue.length && records.length < 12) {
      const record = queue.shift();
      if (!isObject(record) || seen.has(record)) {
        continue;
      }
      seen.add(record);
      records.push(record);

      nestedKeys.forEach((key) => {
        if (isObject(record[key])) {
          queue.push(record[key]);
        }
      });
    }

    return records;
  }

  function queryRecordCandidates(result) {
    if (!result || !isObject(result.data)) {
      return [];
    }
    return collectRecordCandidates(result.data, [
      "data",
      "card",
      "cardInfo",
      "card_info",
      "record",
      "result",
      "payload",
      "response",
    ]);
  }

  function responseRecordCandidates(result) {
    if (!result || !isObject(result.data)) {
      return [];
    }
    return collectRecordCandidates(result.data, [
      "data",
      "result",
      "payload",
      "response",
    ]);
  }

  function firstRecordValue(records, fieldNames) {
    for (const record of records) {
      for (const fieldName of fieldNames) {
        const value = record[fieldName];
        if (value !== undefined && value !== null && String(value).trim()) {
          return value;
        }
      }
    }
    return "";
  }

  function responseFlag(value) {
    if (value === true || value === 1) {
      return true;
    }
    if (value === false || value === 0) {
      return false;
    }
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
    return null;
  }

  function normalizeGptSubmission(result) {
    const records = responseRecordCandidates(result);
    let hasSuccess = responseFlag(result && result.success) === true;
    let hasFailure = responseFlag(result && result.success) === false;

    records.forEach((record) => {
      const flag = responseFlag(record.success);
      if (flag === true) {
        hasSuccess = true;
      } else if (flag === false) {
        hasFailure = true;
      }
    });

    const taskId = asTaskId(
      firstRecordValue(records, [
        "taskId",
        "task_id",
        "requestId",
        "request_id",
      ]),
    );
    const status = String(
      firstRecordValue(records, ["status", "taskStatus", "task_status"]),
    )
      .trim()
      .toLowerCase();
    const completedFlag = records.some(
      (record) => responseFlag(record.completed) === true,
    );
    const hasGptCardInfo = records.some((record) => {
      const value = record.gptCardInfo ?? record.gpt_card_info;
      if (isObject(value)) {
        return Object.keys(value).length > 0;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && String(value).trim() !== "";
    });
    const completed =
      completedFlag ||
      hasGptCardInfo ||
      ["completed", "success", "succeeded", "2"].includes(status);
    const codeOk =
      result &&
      (result.code === null ||
        result.code === undefined ||
        Number(result.code) === 200);
    const accepted =
      Boolean(result && result.httpOk) &&
      result.error !== true &&
      !hasFailure &&
      (hasSuccess || (codeOk && (completed || Boolean(taskId))));
    const detailRecord =
      records.find((record) => {
        const recordTaskId = asTaskId(
          record.taskId ??
            record.task_id ??
            record.requestId ??
            record.request_id,
        );
        return recordTaskId === taskId && Boolean(taskId);
      }) ||
      records.find((record) => (
        "queuePosition" in record ||
        "estimatedWaitSeconds" in record
      )) ||
      result.data;

    return {
      accepted,
      completed,
      taskId,
      detail: isObject(detailRecord) ? detailRecord : {},
    };
  }

  function normalizeCardQueryResult(result) {
    const records = queryRecordCandidates(result);
    const rawStatus = firstRecordValue(records, [
      "status",
      "cardStatus",
      "card_status",
    ]);
    const status = String(rawStatus).trim().toLowerCase();
    const boundEmail = String(
      firstRecordValue(records, [
        "bound_email",
        "boundEmail",
        "binding_email",
        "bindingEmail",
        "user_email",
        "userEmail",
      ]),
    ).trim();
    const usedAt = String(
      firstRecordValue(records, [
        "used_at",
        "usedAt",
        "use_time",
        "useTime",
        "used_time",
        "usedTime",
        "completed_at",
        "completedAt",
      ]),
    ).trim();
    const errorKey = String(resultErrorCode(result) ?? "").toUpperCase();
    const messageKey = serviceErrorKey(result);

    if (
      errorKey.includes("CARD_ALREADY_USED") ||
      messageKey.includes("CARD_ALREADY_USED") ||
      ["1", "used", "succeeded", "completed", "success"].includes(status)
    ) {
      return { kind: "used", boundEmail, usedAt };
    }

    if (
      ["2", "pending", "processing", "working"].includes(status) ||
      asTaskId(result.data.pendingTaskId) ||
      Number(resultErrorCode(result)) === 3001
    ) {
      return { kind: "processing", boundEmail, usedAt };
    }

    if (
      ["unused", "available", "valid"].includes(status) ||
      (apiSucceeded(result) && result.data.success === true)
    ) {
      return { kind: "unused", boundEmail, usedAt };
    }

    if (["failed", "timeout"].includes(status)) {
      return {
        kind: "failed",
        boundEmail,
        usedAt,
        copy: errorCopy(result, "卡密状态异常"),
      };
    }

    return {
      kind: "error",
      boundEmail,
      usedAt,
      copy: errorCopy(result, "卡密查询失败"),
    };
  }

  function formatCardUseTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function unwrapEnvelope(payload) {
    let current = payload;
    let code = null;
    let envelopeSuccess = null;
    let envelopeError = null;
    const messages = [];

    for (let depth = 0; depth < 4 && isObject(current); depth += 1) {
      const looksLikeEnvelope =
        Object.prototype.hasOwnProperty.call(current, "data") &&
        ("code" in current || "success" in current || "error" in current || "message" in current);

      if (!looksLikeEnvelope) {
        break;
      }
      if (code === null && current.code !== undefined && current.code !== null) {
        code = current.code;
      }
      if (typeof current.success === "boolean") {
        envelopeSuccess = current.success;
      }
      if (typeof current.error === "boolean") {
        envelopeError = current.error;
      }
      if (typeof current.message === "string" && current.message.trim()) {
        messages.push(current.message);
      }
      current = current.data;
    }

    const data = isObject(current) ? current : { value: current };
    const businessSuccess =
      typeof data.success === "boolean" ? data.success : envelopeSuccess;
    const dataMessage = asText(data.message) || asText(data.reason);

    return {
      code,
      data,
      success: businessSuccess,
      error: envelopeError,
      message: dataMessage || messages[messages.length - 1] || "",
    };
  }

  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const method = options.method || "POST";
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    state.controllers.add(controller);
    const headers = { Accept: "application/json" };
    const requestOptions = {
      method,
      headers,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(new URL(path, API_BASE), requestOptions);
      const responseText = await response.text();
      let payload = {};

      if (responseText) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          payload = { message: responseText };
        }
      }

      return {
        ...unwrapEnvelope(payload),
        httpOk: response.ok,
        httpStatus: response.status,
      };
    } catch (error) {
      if (error && error.name === "AbortError") {
        if (timedOut) {
          throw new RequestTimeoutError();
        }
        throw new OperationCanceledError();
      }
      if (error instanceof TypeError) {
        throw new NetworkRequestError();
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      state.controllers.delete(controller);
    }
  }

  function apiSucceeded(result) {
    const codeOk =
      result.code === null ||
      result.code === undefined ||
      Number(result.code) === 200;
    return result.httpOk && codeOk;
  }

  function rawBackendMessage(result) {
    if (!result) {
      return "";
    }
    const nestedMessage = firstRecordValue(
      responseRecordCandidates(result),
      ["message", "msg", "reason", "errorMessage", "error_message"],
    );
    return (
      asText(nestedMessage) ||
      asText(result.message)
    );
  }

  function serviceErrorKey(result) {
    return rawBackendMessage(result).trim().toUpperCase();
  }

  function backendMessage(result) {
    const message = rawBackendMessage(result);
    const key = serviceErrorKey(result);
    return SERVICE_ERROR_COPY[key] || SERVICE_STATUS_MESSAGES.has(key) ? "" : message;
  }

  function resultErrorCode(result) {
    if (!result) {
      return null;
    }
    const nestedCode = firstRecordValue(
      responseRecordCandidates(result),
      ["errorCode", "error_code"],
    );
    const value =
      nestedCode !== ""
        ? nestedCode
        : !result.httpOk && Number(result.httpStatus) >= 400
          ? result.httpStatus
          : result.code !== null
            ? result.code
            : result.httpStatus;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }

  function errorCopy(result, fallbackTitle = "请求未完成") {
    const serviceCopy = SERVICE_ERROR_COPY[serviceErrorKey(result)];
    if (serviceCopy) {
      return serviceCopy;
    }

    const code = resultErrorCode(result);
    return (
      ERROR_COPY[code] || {
        title: fallbackTitle,
        detail: "服务暂未返回可确认的结果。请保留卡密，稍后使用卡密查询功能确认。",
      }
    );
  }

  function formatTime(date = new Date()) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function setButtonLoading(button, loading, loadingText) {
    const label = $("span:first-child", button);
    if (!button.dataset.defaultLabel && label) {
      button.dataset.defaultLabel = label.textContent;
    }
    button.classList.toggle("is-loading", loading);
    button.disabled = loading;
    if (label) {
      label.textContent = loading
        ? loadingText
        : button.dataset.defaultLabel || label.textContent;
    }
  }

  function setInputError(input, errorElement, message) {
    input.setAttribute("aria-invalid", message ? "true" : "false");
    errorElement.textContent = message || "";
  }

  function hideNotice() {
    elements.notice.hidden = true;
    elements.notice.className = "notice";
    elements.noticeTitle.textContent = "";
    elements.noticeDetail.textContent = "";
    elements.noticeBackend.textContent = "";
    elements.noticeBackend.hidden = true;
    elements.noticeAction.hidden = true;
    elements.noticeAction.textContent = "";
    elements.noticeAction.onclick = null;
  }

  function showNotice(type, title, detail, backend = "", action = null) {
    elements.notice.hidden = false;
    elements.notice.className = `notice is-${type}`;
    elements.noticeTitle.textContent = title;
    elements.noticeDetail.textContent = detail;
    elements.noticeBackend.textContent = backend ? `服务返回：${backend}` : "";
    elements.noticeBackend.hidden = !backend;
    elements.noticeAction.hidden = !action;
    elements.noticeAction.textContent = action ? action.label : "";
    elements.noticeAction.onclick = action ? action.handler : null;
  }

  function setRecoveryResult(type, title, detail) {
    elements.recoveryResult.className =
      type === "neutral" ? "query-result" : `query-result query-result-${type}`;
    elements.recoveryResultMessage.hidden = false;
    elements.recoveryResultHeading.hidden = true;
    elements.recoveryResultGrid.hidden = true;
    elements.recoveryResultIndicator.className =
      type === "loading" ? "query-spinner" : "query-result-dot";
    elements.recoveryResultTitle.textContent = title;
    elements.recoveryResultDetail.textContent = detail;
    elements.recoveryResultStatus.textContent = "";
    elements.recoveryResultStatus.className = "query-status";
    elements.recoveryResultStatusValue.textContent = "—";
    elements.recoveryResultEmail.textContent = "—";
    elements.recoveryResultUsedAt.textContent = "—";
  }

  function setRecoveryDetails(result) {
    const statusCopy = CARD_STATUS_COPY[result.kind] || {
      label: "状态未知",
      tone: "warning",
    };
    const formattedTime = formatCardUseTime(result.usedAt);

    elements.recoveryResult.className = "query-result query-result-success";
    elements.recoveryResultMessage.hidden = true;
    elements.recoveryResultHeading.hidden = false;
    elements.recoveryResultGrid.hidden = false;
    elements.recoveryResultStatus.textContent = statusCopy.label;
    elements.recoveryResultStatus.className =
      `query-status query-status-${statusCopy.tone}`;
    elements.recoveryResultStatusValue.textContent = statusCopy.label;
    elements.recoveryResultEmail.textContent =
      result.boundEmail || (result.kind === "unused" ? "未绑定" : "未提供");
    elements.recoveryResultUsedAt.textContent =
      result.kind === "unused"
        ? "未使用，请激活卡密"
        : formattedTime || (result.kind === "processing" ? "处理中" : "未提供");
  }

  function updateStepper(activeStep, completeThrough = activeStep - 1) {
    $$("[data-step-indicator]").forEach((item) => {
      const step = Number(item.dataset.stepIndicator);
      item.classList.toggle("is-active", step === activeStep);
      item.classList.toggle("is-complete", step <= completeThrough);
      if (step === activeStep) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function clearCredentialFields() {
    if (state.credentialConfirmTimer !== null) {
      window.clearTimeout(state.credentialConfirmTimer);
      state.credentialConfirmTimer = null;
    }
    elements.credentialInput.value = "";
    elements.forceRecharge.checked = false;
    setInputError(elements.credentialInput, elements.credentialError, "");
    elements.confirmedAccountSummary.hidden = true;
    elements.confirmedAccountEmail.textContent = "—";
    elements.accountConfirmCheckbox.checked = false;
    elements.accountConfirmSubmit.disabled = true;
    elements.accountMembershipNotice.hidden = true;
    if (elements.accountConfirmDialog.open) {
      elements.accountConfirmDialog.close();
    }
    state.confirmedEmail = "";
    state.confirmedPlanType = "";
    state.confirmedRevision = -1;
    state.credentialRevision += 1;
    state.pendingAccountConfirmation = null;
    state.forceRechargeAutoChecked = false;
  }

  function clearCardSecret() {
    elements.cardInput.value = "";
  }

  function clearRecoveryCandidate() {
    if (state.recoveryCandidate) {
      state.recoveryCandidate.card = "";
    }
    state.recoveryCandidate = null;
  }

  function setFlowLocked(locked) {
    state.locked = locked;
    elements.cardInput.disabled = locked || Boolean(state.verified);
    elements.verifyButton.disabled =
      locked ||
      Boolean(state.verified) ||
      normalizeCard(elements.cardInput.value).length < 4;
    elements.backToCard.disabled = locked;
    $$("input, textarea, button", elements.accountForm).forEach((control) => {
      control.disabled = locked;
    });
  }

  function stopActiveRequests() {
    state.controllers.forEach((controller) => controller.abort());
    state.controllers.clear();
    if (state.pollTimer !== null) {
      window.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.resolveDelay) {
      const resolve = state.resolveDelay;
      state.resolveDelay = null;
      resolve();
    }
  }

  function beginRun(phase) {
    stopActiveRequests();
    state.runId += 1;
    state.userStopped = false;
    state.phase = phase;
    setFlowLocked(true);
    return state.runId;
  }

  function endRun(runId) {
    if (runId !== state.runId) {
      return;
    }
    state.phase = "idle";
    setFlowLocked(false);
  }

  function assertRun(runId) {
    if (runId !== state.runId || state.userStopped) {
      throw new OperationCanceledError();
    }
  }

  function waitForNextPoll(ms, runId) {
    return new Promise((resolve) => {
      state.resolveDelay = resolve;
      state.pollTimer = window.setTimeout(() => {
        state.pollTimer = null;
        state.resolveDelay = null;
        resolve();
      }, ms);
    }).then(() => assertRun(runId));
  }

  function scrollToStage(element) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }

  function resetToCard() {
    stopActiveRequests();
    state.runId += 1;
    state.phase = "idle";
    state.userStopped = false;
    state.verified = null;
    state.taskId = "";
    clearCredentialFields();
    clearCardSecret();
    clearRecoveryCandidate();
    elements.accountStage.hidden = true;
    elements.taskStage.hidden = true;
    elements.workspace.classList.add("workspace-initial");
    updateStepper(1, 0);
    setFlowLocked(false);
    hideNotice();
    setInputError(elements.cardInput, elements.cardError, "");
    elements.cardInput.focus();
  }

  function renderTimeline(currentIndex, terminal = "") {
    elements.taskTimeline.replaceChildren();
    TIMELINE.forEach((label, index) => {
      const item = document.createElement("li");
      const dot = document.createElement("span");
      const copy = document.createElement("span");
      const time = document.createElement("time");
      dot.className = "timeline-dot";
      copy.textContent = label;
      time.textContent =
        index < currentIndex ? "已完成" : index === currentIndex ? "进行中" : "等待";

      if (index < currentIndex || (terminal === "success" && index === currentIndex)) {
        item.classList.add("is-done");
        time.textContent = "已完成";
      } else if (index === currentIndex && !terminal) {
        item.classList.add("is-current");
      } else if (index === currentIndex && terminal) {
        item.classList.add(terminal === "success" ? "is-done" : "is-current");
        time.textContent =
          terminal === "success"
            ? "已完成"
            : terminal === "pending"
              ? "待确认"
              : "已停止";
      }

      item.append(dot, copy, time);
      elements.taskTimeline.append(item);
    });
  }

  function showTaskShell(
    title,
    summary,
    taskId,
    productId,
    timelineIndex = 0,
    canStop = false,
    displayMeta = {},
  ) {
    state.taskId = asTaskId(taskId);
    elements.workspace.classList.remove("workspace-initial");
    elements.accountStage.hidden = true;
    elements.taskStage.hidden = false;
    elements.taskTitle.textContent = title;
    elements.taskSummary.textContent = summary;
    elements.taskStatusPill.textContent = "处理中";
    elements.taskStatusPill.className = "status-pill status-processing";
    elements.taskProgress.className = "";
    elements.taskCard.textContent = asText(displayMeta.card) || "未提供";
    elements.taskEmail.textContent = asText(displayMeta.email) || "未提供";
    elements.taskUpdated.textContent = formatTime();
    elements.stopPolling.disabled = !canStop;
    elements.stopPolling.hidden = !canStop;
    elements.startOver.hidden = true;
    renderTimeline(timelineIndex);
    updateStepper(3, 2);
    hideNotice();
    scrollToStage(elements.taskStage);
  }

  function updateTask(title, summary, timelineIndex) {
    elements.taskTitle.textContent = title;
    elements.taskSummary.textContent = summary;
    elements.taskUpdated.textContent = formatTime();
    renderTimeline(timelineIndex);
  }

  function finishTask(
    outcome,
    title,
    detail,
    backend = "",
    timelineIndex = null,
    options = {},
  ) {
    const isSuccess = outcome === "success";
    const isWarning = outcome === "warning";
    const isSubmittedPending =
      isWarning && options.submitted === true && Boolean(state.taskId);
    const index = timelineIndex === null ? TIMELINE.length - 1 : timelineIndex;

    elements.taskTitle.textContent = title;
    elements.taskSummary.textContent = detail;
    elements.taskUpdated.textContent = formatTime();
    elements.taskStatusPill.textContent = isSuccess
      ? "充值成功"
      : isWarning
        ? "需要确认"
        : "处理失败";
    elements.taskStatusPill.className = `status-pill ${
      isSuccess
        ? "status-success"
        : isWarning
          ? "status-warning"
          : "status-error"
    }`;
    elements.taskProgress.className = isSuccess
      ? "is-complete"
      : isSubmittedPending
        ? "is-pending"
        : "is-stopped";
    renderTimeline(
      index,
      isSuccess ? "success" : isSubmittedPending ? "pending" : outcome,
    );
    elements.stopPolling.disabled = true;
    elements.stopPolling.hidden = true;
    elements.startOver.hidden = isSubmittedPending;
    showNotice(isSuccess ? "success" : isWarning ? "warning" : "error", title, detail, backend);
    clearCredentialFields();
    clearCardSecret();
    clearRecoveryCandidate();
    state.verified = null;
  }

  function processingSummary(data, fallback) {
    const queue = Number(data.queuePosition);
    const seconds = Number(data.estimatedWaitSeconds);
    if (Number.isFinite(queue) && queue > 0 && Number.isFinite(seconds) && seconds > 0) {
      return `当前排队第 ${queue} 位，预计还需约 ${Math.max(1, Math.ceil(seconds / 60))} 分钟。`;
    }
    if (Number.isFinite(queue) && queue > 0) {
      return `当前排队第 ${queue} 位，页面将在稍后继续查询。`;
    }
    return fallback;
  }

  function classifyGptStatus(result) {
    if (!apiSucceeded(result)) {
      if (Number(result.httpStatus) === 404 || Number(result.code) === 404) {
        return { kind: "failed", code: 404 };
      }
      const code = Number(resultErrorCode(result));
      if (code >= 400 && code < 500) {
        return { kind: "failed", code };
      }
      return { kind: "request-error" };
    }

    const data = result.data;
    const status = String(data.status ?? "").toLowerCase();
    if (
      data.success === true ||
      status === "completed" ||
      status === "success" ||
      status === "2"
    ) {
      return { kind: "success" };
    }
    if (
      data.success === false ||
      status === "failed" ||
      status === "-1" ||
      status === "unknown"
    ) {
      return { kind: "failed", code: status === "unknown" ? 404 : undefined };
    }
    return { kind: "processing" };
  }

  async function queryStatusOnce(taskId, productId, card = "") {
    const body = {
      taskId,
      productId,
    };
    if (card) {
      body.cardInfo = card;
    }
    const result = await requestJson("/api/recharge/query-task-status", {
      body,
      timeoutMs: REQUEST_TIMEOUT,
    });
    return { result, outcome: classifyGptStatus(result) };
  }

  async function confirmSubmittedTaskByCard(card, runId) {
    try {
      const result = await requestJson("/api/cards/verify", {
        body: { cardInfo: card },
        timeoutMs: REQUEST_TIMEOUT,
      });
      assertRun(runId);
      return {
        kind: normalizeCardQueryResult(result).kind,
        result,
      };
    } catch (error) {
      if (error instanceof OperationCanceledError) {
        throw error;
      }
      return { kind: "request-error", error };
    }
  }

  async function pollGptTask(taskId, card, productId, runId, deadline) {
    let consecutiveErrors = 0;
    let pollCount = 0;
    let lastResult = null;
    state.phase = "gpt-poll";

    while (Date.now() < deadline) {
      assertRun(runId);
      pollCount += 1;
      let result;
      try {
        ({ result } = await queryStatusOnce(taskId, productId, card));
        assertRun(runId);
      } catch (error) {
        if (error instanceof OperationCanceledError) {
          throw error;
        }
        consecutiveErrors += 1;
        const confirmation = await confirmSubmittedTaskByCard(card, runId);
        if (confirmation.kind === "used") {
          return {
            kind: "success",
            result: confirmation.result,
            confirmedByCard: true,
          };
        }
        if (confirmation.kind !== "request-error") {
          consecutiveErrors = 0;
        }
        updateTask(
          "任务已提交，正在核对卡密状态",
          confirmation.kind === "processing"
            ? "卡密仍在处理中，页面会继续确认；请勿重新提交充值。"
            : "任务接口暂时没有返回，但页面仍在确认卡密是否已使用；请勿重新提交充值。",
          1,
        );
        if (consecutiveErrors >= 3) {
          return { kind: "paused", error };
        }
        await waitForNextPoll(POLL_INTERVAL, runId);
        continue;
      }

      lastResult = result;
      const outcome = classifyGptStatus(result);
      if (outcome.kind === "success") {
        return { kind: "success", result };
      }

      const shouldConfirmByCard =
        outcome.kind === "failed" ||
        outcome.kind === "request-error" ||
        pollCount % 2 === 0;
      let confirmation = null;
      if (shouldConfirmByCard) {
        confirmation = await confirmSubmittedTaskByCard(card, runId);
        if (confirmation.kind === "used") {
          return {
            kind: "success",
            result: confirmation.result,
            confirmedByCard: true,
          };
        }
      }

      if (outcome.kind === "failed") {
        consecutiveErrors = 0;
        updateTask(
          "任务已提交，正在确认充值结果",
          confirmation && confirmation.kind === "processing"
            ? "卡密状态显示正在处理，页面会继续查询；请勿重新提交充值。"
            : "任务接口暂未给出可确认的结果，页面正在核对卡密是否已使用；请勿重新提交充值。",
          1,
        );
        await waitForNextPoll(POLL_INTERVAL, runId);
        continue;
      }
      if (outcome.kind === "request-error") {
        consecutiveErrors += 1;
        if (confirmation && confirmation.kind !== "request-error") {
          consecutiveErrors = 0;
        } else if (consecutiveErrors >= 3) {
          return { kind: "paused", result };
        }
      } else {
        consecutiveErrors = 0;
      }

      updateTask(
        "GPT 正在处理",
        processingSummary(result.data, "任务已受理，页面将在几秒后继续查询。"),
        1,
      );
      await waitForNextPoll(POLL_INTERVAL, runId);
    }

    const finalConfirmation = await confirmSubmittedTaskByCard(card, runId);
    if (finalConfirmation.kind === "used") {
      return {
        kind: "success",
        result: finalConfirmation.result,
        confirmedByCard: true,
      };
    }
    return { kind: "timeout", result: lastResult };
  }

  function renderPollOutcome(outcome) {
    if (outcome.kind === "success") {
      finishTask(
        "success",
        "GPT 充值成功",
        outcome.confirmedByCard
          ? "卡密状态已变为“已使用”，说明本次充值已经完成。若会员状态未立即显示，请刷新官方页面或重新登录。"
          : "充值已经完成。若会员状态未立即显示，请稍后刷新官方页面或重新登录。",
        backendMessage(outcome.result),
      );
      return;
    }
    if (outcome.kind === "failed") {
      if (state.taskId) {
        finishTask(
          "warning",
          "任务已提交，结果待确认",
          "已取得任务 ID，但任务接口暂未给出可确认的结果。请勿重复提交，稍后用原卡密查询状态。",
          "",
          1,
          { submitted: true },
        );
        return;
      }
      const copy =
        Number(outcome.code) === 404
          ? ERROR_COPY[404]
          : errorCopy(outcome.result, "GPT 充值失败");
      finishTask("error", copy.title, copy.detail, backendMessage(outcome.result), 1);
      return;
    }
    finishTask(
      "warning",
      "任务已提交，结果待确认",
      outcome.kind === "timeout"
        ? "已取得任务 ID，但卡密状态在本次自动确认时限内尚未变为“已使用”。请勿重复提交，稍后用原卡密查询状态。"
        : "已取得任务 ID，但连续多次未取得任务或卡密状态。请勿重复提交，稍后用原卡密查询状态。",
      "",
      1,
      { submitted: true },
    );
  }

  function credentialRoots(parsed) {
    if (!isObject(parsed)) {
      return [];
    }
    const roots = [];
    const add = (value) => {
      if (isObject(value) && !roots.includes(value)) {
        roots.push(value);
      }
    };
    add(parsed.session);
    add(isObject(parsed.data) ? parsed.data.session : null);
    add(parsed.data);
    add(parsed);
    return roots;
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
      (isObject(parsed.data.user) ||
        isObject(parsed.data.account) ||
        typeof parsed.data.accessToken === "string")
    ) {
      return parsed.data;
    }
    return parsed;
  }

  function authoritativeTokenEmails(payload) {
    const user = isObject(payload.user) ? payload.user : {};
    const profile = isObject(payload.profile) ? payload.profile : {};
    const openAiProfile = isObject(payload["https://api.openai.com/profile"])
      ? payload["https://api.openai.com/profile"]
      : {};
    return [payload.email, user.email, profile.email, openAiProfile.email].filter((value) =>
      validEmail(value),
    );
  }

  function credentialPlanType(roots, tokenPayload) {
    const candidates = [];
    roots.forEach((root) => {
      const account = isObject(root.account) ? root.account : {};
      const user = isObject(root.user) ? root.user : {};
      candidates.push(
        account.planType,
        account.plan_type,
        root.planType,
        root.plan_type,
        user.planType,
        user.plan_type,
      );
    });
    const authClaim = isObject(tokenPayload["https://api.openai.com/auth"])
      ? tokenPayload["https://api.openai.com/auth"]
      : {};
    candidates.push(
      authClaim.chatgpt_plan_type,
      authClaim.planType,
      authClaim.plan_type,
      tokenPayload.chatgpt_plan_type,
      tokenPayload.planType,
      tokenPayload.plan_type,
    );
    const plan = candidates.find((value) => typeof value === "string" && value.trim());
    return plan ? plan.trim().toLowerCase() : "unknown";
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
      return { error: "Session 中的 accessToken 不是完整的三段式 JWT。" };
    }
    const header = decodeJwtSection(parts[0]);
    const payload = decodeJwtSection(parts[1]);
    if (!header || !payload || !Object.keys(payload).length) {
      return { error: "Session 中的 accessToken 已损坏或内容无法解析。" };
    }
    if (payload.exp !== undefined) {
      const expiresAt = Number(payload.exp);
      if (!Number.isFinite(expiresAt)) {
        return { error: "Session 中的 accessToken 过期时间格式异常。" };
      }
      if (expiresAt <= Date.now() / 1000) {
        return { error: "Session 中的 accessToken 已过期，请重新获取 Session。" };
      }
    }
    return { token, payload };
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

  function invalidSession(message) {
    return { validationError: message };
  }

  function extractGptCredential(input) {
    let raw = String(input || "").trim();
    if (!raw) {
      return null;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) {
        return invalidSession("请粘贴完整 Session JSON，不能只粘贴 AccessToken。");
      }
      return invalidSession("Session 格式不正确，请确认复制的是完整 JSON。");
    }

    if (!isObject(parsed) || Array.isArray(parsed)) {
      return invalidSession("Session 必须是完整的 JSON 对象，不能只粘贴 AccessToken。");
    }
    const sessionRoot = completeSessionRoot(parsed);
    const user = isObject(sessionRoot.user) ? sessionRoot.user : null;
    if (!user) {
      return invalidSession("Session 不完整：缺少 user 账户信息。");
    }
    const email = String(user.email || "").trim();
    if (!validEmail(email)) {
      return invalidSession("Session 不完整：缺少有效的 user.email 账户邮箱。");
    }
    const account = isObject(sessionRoot.account) ? sessionRoot.account : null;
    if (!account) {
      return invalidSession("Session 不完整：缺少 account 账户信息。");
    }
    const accountId = String(account.id || "").trim();
    if (!accountId) {
      return invalidSession("Session 不完整：缺少 account.id 账户 ID。");
    }
    if (typeof sessionRoot.accessToken !== "string" || !sessionRoot.accessToken.trim()) {
      return invalidSession("Session 不完整：缺少 accessToken。");
    }
    const tokenInspection = inspectAccessToken(sessionRoot.accessToken);
    if (tokenInspection.error) {
      return invalidSession(tokenInspection.error);
    }

    const roots = credentialRoots(parsed);
    const token = tokenInspection.token;
    const tokenPayload = tokenInspection.payload;
    const tokenEmails = authoritativeTokenEmails(tokenPayload);
    const emailCandidates = uniqueEmails([email, ...tokenEmails]);
    const expiresValue = [sessionRoot.expires, ...roots.map((root) => root.expires)].find(
      (value) => value !== undefined && value !== null && value !== "",
    );
    const sessionExpiresAt = sessionExpiryTimestamp(expiresValue);
    if (Number.isNaN(sessionExpiresAt)) {
      return invalidSession("Session 的 expires 过期时间格式异常，请重新获取 Session。");
    }
    if (sessionExpiresAt !== null && sessionExpiresAt <= Date.now()) {
      return invalidSession("Session 已过期，请重新登录 ChatGPT 后获取新的 Session。");
    }
    const planType = credentialPlanType(roots, tokenPayload);
    const fullAuthData = raw;
    raw = "";
    return {
      token,
      fullAuthData,
      email,
      emailSource: "Session",
      emailConflict: emailCandidates.length > 1,
      emailCandidates,
      planType,
      hasMembership: hasPaidMembership(planType),
      accountId,
    };
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function hasPaidMembership(planType) {
    const value = String(planType || "").trim().toLowerCase();
    return /(^|[_-])(plus|pro|team|business|enterprise|premium|paid)([_-]|$)/.test(
      value,
    );
  }

  function planTypeLabel(planType) {
    const value = String(planType || "").trim().toLowerCase();
    if (!value || value === "unknown") {
      return "未识别";
    }
    if (/(^|[_-])free([_-]|$)/.test(value)) {
      return "免费版";
    }
    return value.toUpperCase();
  }

  function scrubCredentialObject(credential) {
    if (!credential) {
      return;
    }
    credential.token = "";
    credential.fullAuthData = "";
    if (Array.isArray(credential.emailCandidates)) {
      credential.emailCandidates.fill("");
    }
  }

  function invalidateAccountConfirmation(options = {}) {
    state.confirmedEmail = "";
    state.confirmedPlanType = "";
    state.confirmedRevision = -1;
    state.pendingAccountConfirmation = null;
    elements.confirmedAccountSummary.hidden = true;
    elements.confirmedAccountEmail.textContent = "—";
    elements.accountConfirmCheckbox.checked = false;
    elements.accountConfirmSubmit.disabled = true;
    if (options.closeDialog !== false && elements.accountConfirmDialog.open) {
      elements.accountConfirmDialog.close();
    }
    if (options.resetAutoForce !== false && state.forceRechargeAutoChecked) {
      elements.forceRecharge.checked = false;
      state.forceRechargeAutoChecked = false;
    }
  }

  function readCredentialForConfirmation(showErrors = true) {
    const credential = extractGptCredential(elements.credentialInput.value);
    if (!credential || credential.validationError) {
      if (showErrors) {
        setInputError(
          elements.credentialInput,
          elements.credentialError,
          credential && credential.validationError
            ? credential.validationError
            : "请粘贴包含有效 AccessToken 的完整 Session JSON。",
        );
      }
      return null;
    }
    if (credential.emailConflict) {
      if (showErrors) {
        setInputError(
          elements.credentialInput,
          elements.credentialError,
          "Session 与 AccessToken 中的邮箱不一致，请重新获取正确的 Session。",
        );
      }
      scrubCredentialObject(credential);
      return null;
    }
    if (!validEmail(credential.email)) {
      if (showErrors) {
        setInputError(
          elements.credentialInput,
          elements.credentialError,
          "没有从 Session 中识别到账户邮箱，请复制完整 Session JSON 后重试。",
        );
      }
      scrubCredentialObject(credential);
      return null;
    }
    setInputError(elements.credentialInput, elements.credentialError, "");
    return credential;
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

  function extractRefreshSession(input) {
    let raw = String(input || "").trim();
    if (!raw) {
      throw new Error("请先粘贴完整的 Session JSON。");
    }
    if (raw.length > REFRESH_SESSION_LIMIT) {
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
    const tokenInspection = inspectAccessToken(sessionRoot.accessToken);
    if (tokenInspection.error) {
      throw new Error(tokenInspection.error);
    }

    const user = isObject(sessionRoot.user) ? sessionRoot.user : null;
    const email = String(user && user.email ? user.email : "").trim();
    if (!email) {
      tokenInspection.token = "";
      throw new Error("缺少 user.email 账户信息。");
    }
    if (!validEmail(email)) {
      tokenInspection.token = "";
      throw new Error("Session 中的账户邮箱格式不正确。");
    }
    const tokenEmails = authoritativeTokenEmails(tokenInspection.payload);
    const emailCandidates = uniqueEmails([email, ...tokenEmails]);
    if (emailCandidates.length > 1) {
      tokenInspection.token = "";
      emailCandidates.fill("");
      throw new Error("Session 与 AccessToken 中的邮箱不一致，请重新获取 Session。");
    }
    emailCandidates.fill("");

    if (!sessionRoot.WARNING_BANNER && !parsed.WARNING_BANNER) {
      tokenInspection.token = "";
      throw new Error("缺少 WARNING_BANNER 安全提示字段。");
    }

    const expiresValue =
      sessionRoot.expires !== undefined ? sessionRoot.expires : parsed.expires;
    const expiresAt = sessionExpiryTimestamp(expiresValue);
    if (Number.isNaN(expiresAt)) {
      tokenInspection.token = "";
      throw new Error("Session 的 expires 过期时间格式异常，请重新获取 Session。");
    }
    if (expiresAt !== null && expiresAt <= Date.now()) {
      tokenInspection.token = "";
      throw new Error("Session 已过期，请重新登录 ChatGPT 后获取新的 Session。");
    }

    tokenInspection.token = "";
    return { email, fullSession: raw };
  }

  function sanitizeRefreshMessage(value, fallback) {
    const text = String(value || "").trim();
    if (!text) {
      return fallback;
    }
    const sanitized = text
      .replace(
        /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
        "[凭证已隐藏]",
      )
      .replace(
        /"accessToken"\s*:\s*"[^"]+"/gi,
        '"accessToken":"[已隐藏]"',
      );
    return sanitized.length > 180 ? `${sanitized.slice(0, 180)}…` : sanitized;
  }

  function refreshFailureMessage(message, status) {
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
      return "接口未授权当前请求，请确认域名或接口权限。";
    }
    return "刷新未完成，请稍后重试。";
  }

  function setRefreshBusy(busy) {
    state.refreshBusy = busy;
    elements.refreshSession.disabled = busy;
    elements.refreshSubmit.disabled = busy;
    elements.refreshClear.disabled = busy;
    elements.refreshSubmitSpinner.hidden = !busy;
    elements.refreshSubmitLabel.textContent = busy ? "正在刷新" : "校验并刷新";
  }

  function syncRefreshCount() {
    elements.refreshCount.textContent = `${elements.refreshSession.value.length} 字符`;
  }

  function setRefreshStatus(kind, label) {
    elements.refreshStatus.className =
      kind === "idle"
        ? "refresh-status-pill"
        : `refresh-status-pill refresh-status-${kind}`;
    elements.refreshStatus.textContent = label;
  }

  function showRefreshEmpty(options = {}) {
    const kind = options.kind || "idle";
    elements.refreshTableWrap.hidden = true;
    elements.refreshEmpty.hidden = false;
    elements.refreshEmpty.className =
      kind === "error"
        ? "refresh-state-message refresh-state-error"
        : "refresh-state-message";
    elements.refreshLoadingSpinner.hidden = kind !== "loading";
    elements.refreshStateSymbol.hidden = kind === "loading";
    elements.refreshStateSymbol.textContent = kind === "error" ? "!" : "↻";
    elements.refreshStateTitle.textContent =
      options.title || "等待刷新，请粘贴完整Session后提交刷新";
    elements.refreshStateDetail.textContent = options.detail || "";
    setRefreshStatus(kind, options.statusLabel || "等待输入");
  }

  function showRefreshResult(result) {
    elements.refreshEmpty.hidden = true;
    elements.refreshTableWrap.hidden = false;
    elements.refreshResultEmail.textContent = result.email;
    elements.refreshResultTag.className =
      `refresh-result-tag refresh-result-tag-${result.tone}`;
    elements.refreshResultTag.textContent = result.statusLabel;
    elements.refreshResultTime.textContent = result.refreshedAt;
    elements.refreshResultMessage.textContent = result.message;
    setRefreshStatus(
      result.tone,
      result.tone === "success" ? "1 条记录" : result.statusLabel,
    );
  }

  function resetRefreshPanel(options = {}) {
    elements.refreshError.textContent = "";
    elements.refreshSession.removeAttribute("aria-invalid");
    if (options.clearInput !== false) {
      elements.refreshSession.value = "";
      syncRefreshCount();
    }
    if (options.keepResult !== true) {
      showRefreshEmpty();
    }
  }

  function openRefreshDialog() {
    if (state.refreshBusy || !elements.refreshBackdrop.hidden) {
      return;
    }
    if (state.locked) {
      showNotice(
        "warning",
        "当前充值任务仍在处理",
        "请等待当前任务结束，再进行订阅刷新。",
      );
      return;
    }
    closeRecoveryDialog();
    state.refreshLastFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.refreshPreviousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elements.refreshBackdrop.hidden = false;
    window.setTimeout(() => elements.refreshSession.focus(), 0);
  }

  function closeRefreshDialog() {
    if (state.refreshController) {
      state.refreshController.abort();
      state.refreshController = null;
    }
    setRefreshBusy(false);
    elements.refreshBackdrop.hidden = true;
    elements.refreshSession.value = "";
    elements.refreshError.textContent = "";
    elements.refreshSession.removeAttribute("aria-invalid");
    syncRefreshCount();
    document.body.style.overflow = state.refreshPreviousBodyOverflow;
    const previous = state.refreshLastFocused;
    state.refreshLastFocused = null;
    if (previous && previous.isConnected) {
      window.setTimeout(() => previous.focus(), 0);
    }
  }

  function handleRefreshDialogKeydown(event) {
    if (elements.refreshBackdrop.hidden) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeRefreshDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = $$('[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', elements.refreshDialog);
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

  async function handleRefreshSubmit(event) {
    event.preventDefault();
    if (state.refreshBusy) {
      return;
    }

    let validated;
    try {
      validated = extractRefreshSession(elements.refreshSession.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Session 校验失败。";
      elements.refreshError.textContent = message;
      elements.refreshSession.setAttribute("aria-invalid", "true");
      showRefreshEmpty({
        kind: "error",
        statusLabel: "格式错误",
        title: "输入内容未通过校验",
        detail: message,
      });
      elements.refreshSession.focus();
      return;
    }

    elements.refreshError.textContent = "";
    elements.refreshSession.removeAttribute("aria-invalid");
    const controller = new AbortController();
    const requestBody = { token: validated.fullSession };
    state.refreshController = controller;
    let timedOut = false;
    let responseStarted = false;
    let backendMessageText = "";
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REFRESH_TIMEOUT);
    setRefreshBusy(true);
    showRefreshEmpty({
      kind: "loading",
      statusLabel: "处理中",
      title: "正在同步订阅",
      detail: "请求已安全提交，请勿关闭页面。最长等待约 30 秒。",
    });

    try {
      const response = await fetch(
        new URL("/api/cards/refresh-subscription", API_BASE),
        {
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
        },
      );
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
      backendMessageText = message;
      const codeFailed = root.code !== undefined && Number(root.code) !== 200;
      const succeeded = response.ok && !codeFailed && success === true;
      const fallback = succeeded
        ? "刷新成功"
        : refreshFailureMessage(message, response.status);
      const safeMessage = sanitizeRefreshMessage(
        message || (parsedJson ? "" : responseText),
        fallback,
      );

      showRefreshResult({
        email: validated.email,
        statusLabel: succeeded ? "刷新成功" : "刷新失败",
        refreshedAt: formatRefreshTime(),
        message: safeMessage,
        tone: succeeded ? "success" : "error",
      });
      if (succeeded) {
        elements.refreshSession.value = "";
        syncRefreshCount();
      }
    } catch (error) {
      if (controller.signal.aborted && !timedOut) {
        return;
      }
      const networkFailure =
        !responseStarted &&
        error instanceof Error &&
        /fetch|network|load failed/i.test(error.message);
      const message = timedOut
        ? "请求在 30 秒内未返回；服务器端可能仍已完成，请先核对订阅状态。"
        : networkFailure
          ? "未收到接口响应，请检查网络、HTTPS 或跨域设置。"
          : error instanceof Error
            ? error.message
            : "刷新未完成，请稍后重试。";
      showRefreshResult({
        email: validated.email,
        statusLabel: timedOut ? "结果未知" : "刷新失败",
        refreshedAt: formatRefreshTime(),
        message: sanitizeRefreshMessage(
          backendMessageText || message,
          "刷新未完成，请稍后重试。",
        ),
        tone: timedOut ? "unknown" : "error",
      });
    } finally {
      window.clearTimeout(timeoutId);
      requestBody.token = "";
      validated.fullSession = "";
      if (state.refreshController === controller) {
        state.refreshController = null;
      }
      setRefreshBusy(false);
    }
  }

  function openAccountConfirmation(options = {}) {
    if (state.credentialConfirmTimer !== null) {
      window.clearTimeout(state.credentialConfirmTimer);
      state.credentialConfirmTimer = null;
    }
    if (state.locked) {
      return false;
    }
    const credential = readCredentialForConfirmation(options.showErrors !== false);
    if (!credential) {
      return false;
    }

    const pending = {
      email: credential.email,
      planType: credential.planType,
      hasMembership: credential.hasMembership,
      revision: state.credentialRevision,
    };
    state.pendingAccountConfirmation = pending;
    elements.accountConfirmEmail.textContent = pending.email;
    elements.accountConfirmPlan.textContent = planTypeLabel(pending.planType);
    elements.accountMembershipNotice.hidden = !pending.hasMembership;
    elements.accountConfirmCheckbox.checked = false;
    elements.accountConfirmSubmit.disabled = true;
    if (!elements.accountConfirmDialog.open) {
      elements.accountConfirmDialog.showModal();
    }
    window.setTimeout(() => elements.accountConfirmCheckbox.focus(), 0);
    scrubCredentialObject(credential);
    return true;
  }

  function closeAccountConfirmation() {
    elements.accountConfirmCheckbox.checked = false;
    elements.accountConfirmSubmit.disabled = true;
    state.pendingAccountConfirmation = null;
    if (elements.accountConfirmDialog.open) {
      elements.accountConfirmDialog.close();
    }
  }

  function confirmAccountFromDialog() {
    const pending = state.pendingAccountConfirmation;
    if (!pending || !elements.accountConfirmCheckbox.checked) {
      return;
    }
    elements.accountConfirmSubmit.disabled = true;
    const credential = readCredentialForConfirmation(true);
    if (
      !credential ||
      pending.revision !== state.credentialRevision ||
      normalizeEmail(pending.email) !== normalizeEmail(credential && credential.email) ||
      pending.planType !== (credential && credential.planType)
    ) {
      if (credential) {
        scrubCredentialObject(credential);
      }
      invalidateAccountConfirmation();
      setInputError(
        elements.credentialInput,
        elements.credentialError,
        "Session 内容已变化，请重新确认充值邮箱。",
      );
      elements.credentialInput.focus();
      return;
    }

    state.confirmedEmail = credential.email;
    state.confirmedPlanType = credential.planType;
    state.confirmedRevision = state.credentialRevision;
    elements.confirmedAccountEmail.textContent = credential.email;
    elements.confirmedAccountSummary.hidden = false;
    if (credential.hasMembership) {
      elements.forceRecharge.checked = true;
      state.forceRechargeAutoChecked = true;
    }
    scrubCredentialObject(credential);
    closeAccountConfirmation();
    window.setTimeout(() => {
      if (
        !state.locked &&
        state.confirmedRevision === state.credentialRevision &&
        state.confirmedEmail
      ) {
        elements.accountForm.requestSubmit();
      }
    }, 0);
  }

  function handleCredentialInput() {
    state.credentialRevision += 1;
    if (state.credentialConfirmTimer !== null) {
      window.clearTimeout(state.credentialConfirmTimer);
      state.credentialConfirmTimer = null;
    }
    invalidateAccountConfirmation();
    setInputError(elements.credentialInput, elements.credentialError, "");
    if (!elements.credentialInput.value.trim()) {
      return;
    }
    state.credentialConfirmTimer = window.setTimeout(() => {
      state.credentialConfirmTimer = null;
      openAccountConfirmation({ showErrors: true });
    }, 260);
  }

  async function handleCardVerification(event) {
    event.preventDefault();
    if (state.locked) {
      return;
    }

    const card = normalizeCard(elements.cardInput.value);
    if (!card) {
      setInputError(elements.cardInput, elements.cardError, "请输入完整卡密。");
      elements.cardInput.focus();
      return;
    }

    setInputError(elements.cardInput, elements.cardError, "");
    hideNotice();
    clearRecoveryCandidate();
    const runId = beginRun("verify-card");
    setButtonLoading(elements.verifyButton, true, "正在验证");

    try {
      const result = await requestJson("/api/cards/verify", {
        body: { cardInfo: card },
        timeoutMs: REQUEST_TIMEOUT,
      });
      assertRun(runId);
      const data = result.data;
      const productId = Number(data.productId);
      const pendingTaskId = asTaskId(data.pendingTaskId);

      if (pendingTaskId) {
        if (!isSupportedProductId(productId)) {
          showNotice(
            "warning",
            "无法确认该任务属于 GPT",
            Number.isFinite(productId)
              ? `任务 ID：${pendingTaskId}，商品 ${productId}。系统1仅处理 GPT 商品 3 和商品 10，请返回充值系统2处理。`
              : `任务 ID：${pendingTaskId}。服务未返回商品 ID，页面不会猜测接口；请先确认该任务属于 GPT 商品 3 或商品 10。`,
            backendMessage(result),
          );
          return;
        }
        state.recoveryCandidate = {
          taskId: pendingTaskId,
          card,
          productId,
          email: asText(
            data.userEmail ?? data.email ?? data.boundEmail ?? data.bindEmail,
          ),
        };
        showNotice(
          "warning",
          "这张卡已有处理中任务",
          `任务 ID：${pendingTaskId}。可继续查询原 GPT 任务，不会重新提交充值。`,
          backendMessage(result),
          {
            label: "继续查询原任务",
            handler: resumeRecoveryCandidate,
          },
        );
        return;
      }

      if (!apiSucceeded(result) || data.success !== true) {
        const copy = errorCopy(result, "卡密验证未通过");
        showNotice("error", copy.title, copy.detail, backendMessage(result));
        return;
      }
      if (!isSupportedProductId(productId)) {
        showNotice(
          "error",
          "该卡密不属于 GPT 商品",
          Number.isFinite(productId)
            ? `系统1仅支持 GPT 商品 3 和商品 10；当前卡密属于商品 ${productId}，页面没有提交充值。`
            : "服务未返回 GPT 商品 3 或商品 10 标识，页面没有提交充值。",
          backendMessage(result),
        );
        return;
      }

      state.verified = {
        card,
        productId,
        productName: asText(data.productName) || "GPT",
      };
      elements.workspace.classList.remove("workspace-initial");
      elements.accountStage.hidden = false;
      elements.taskStage.hidden = true;
      elements.verifiedProductCopy.textContent =
        `已匹配 ${state.verified.productName}（商品 ${productId}），请粘贴 ChatGPT Session JSON。`;
      updateStepper(2, 1);
      showNotice(
        "success",
        "卡密验证通过",
        "请确认邮箱无误再提交。",
        backendMessage(result),
      );
      scrollToStage(elements.accountStage);
    } catch (error) {
      if (error instanceof OperationCanceledError) {
        return;
      }
      showNotice(
        "warning",
        error instanceof RequestTimeoutError ? "卡密验证超时" : "暂时无法连接服务",
        error instanceof RequestTimeoutError
          ? "验证请求没有在规定时间内返回。请稍后用卡密查询状态，再决定是否重试。"
          : "未能取得卡密验证结果。请检查网络后使用卡密查询。",
      );
    } finally {
      setButtonLoading(elements.verifyButton, false);
      endRun(runId);
    }
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    if (state.locked || !state.verified || !state.verified.card) {
      if (!state.locked) {
        showNotice(
          "warning",
          "请先验证卡密",
          "验证 GPT 商品 3 或商品 10 卡密后才能提交充值。",
        );
      }
      return;
    }

    const credential = readCredentialForConfirmation(true);
    if (!credential) {
      elements.credentialInput.focus();
      return;
    }
    if (
      state.confirmedRevision !== state.credentialRevision ||
      normalizeEmail(state.confirmedEmail) !== normalizeEmail(credential.email) ||
      state.confirmedPlanType !== credential.planType
    ) {
      scrubCredentialObject(credential);
      openAccountConfirmation({ showErrors: true });
      return;
    }

    setInputError(elements.credentialInput, elements.credentialError, "");
    const card = state.verified.card;
    const productId = state.verified.productId;
    const payload = {
      cardInfo: card,
      userGptToken: credential.token,
      fullAuthData: credential.fullAuthData || credential.token,
      productId,
      forceRecharge: elements.forceRecharge.checked,
    };
    const resolvedEmail = credential.email;
    payload.userEmail = resolvedEmail;

    clearCredentialFields();
    clearCardSecret();
    const runId = beginRun("gpt-submit");
    setButtonLoading(elements.submitButton, true, "正在提交");
    showTaskShell(
      "正在提交 GPT 充值",
      "正在创建任务，请勿刷新或重复点击提交。",
      "",
      productId,
      0,
      false,
      { card, email: resolvedEmail },
    );

    try {
      const result = await requestJson("/api/cards/verify-gpt", {
        body: payload,
        timeoutMs: SUBMIT_TIMEOUT,
      });
      assertRun(runId);
      const submission = normalizeGptSubmission(result);
      const taskId = submission.taskId;

      if (submission.accepted && submission.completed) {
        finishTask(
          "success",
          "GPT 充值成功",
          "服务已直接完成充值。若会员状态未立即显示，请稍后刷新官方页面。",
          backendMessage(result),
        );
        return;
      }
      if (!taskId) {
        if (!submission.accepted) {
          const copy = errorCopy(result, "GPT 充值未被受理");
          finishTask("error", copy.title, copy.detail, backendMessage(result), 0);
          return;
        }
        finishTask(
          "warning",
          "提交结果待确认",
          "服务已接收请求，但没有返回可继续查询的任务号。请勿重复提交，稍后使用原卡密查询状态。",
          backendMessage(result),
          0,
        );
        return;
      }

      state.taskId = taskId;
      elements.stopPolling.disabled = false;
      elements.stopPolling.hidden = false;
      updateTask(
        "GPT 任务已提交",
        processingSummary(
          submission.detail,
          "已取得任务 ID，页面将持续核对任务与卡密状态。",
        ),
        1,
      );
      const outcome = await pollGptTask(
        taskId,
        card,
        productId,
        runId,
        Date.now() + POLL_LIMIT,
      );
      assertRun(runId);
      renderPollOutcome(outcome);
    } catch (error) {
      if (error instanceof OperationCanceledError) {
        return;
      }
      finishTask(
        "warning",
        error instanceof RequestTimeoutError ? "提交结果暂不确定" : "未能确认提交结果",
        "请求可能已经到达服务端。请勿立即重新提交，先用原卡密查询是否产生了任务。",
        "",
        0,
      );
    } finally {
      payload.cardInfo = "";
      payload.userGptToken = "";
      payload.fullAuthData = "";
      if (payload.userEmail) {
        payload.userEmail = "";
      }
      scrubCredentialObject(credential);
      setButtonLoading(elements.submitButton, false);
      endRun(runId);
    }
  }

  function resetRecoveryPanel() {
    setInputError(elements.recoveryValue, elements.recoveryError, "");
    setRecoveryResult(
      "neutral",
      "等待查询",
      "查询后会显示使用状态、绑定邮箱和使用时间，如有异常联系客服处理。",
    );
  }

  function syncRecoverySubmitState() {
    elements.recoverySubmit.disabled =
      state.recoveryBusy || normalizeQueryCard(elements.recoveryValue.value).length < 4;
  }

  function openRecoveryDialog() {
    if (!elements.recoveryDialog.open) {
      elements.recoveryDialog.showModal();
    }
    window.setTimeout(() => elements.recoveryValue.focus(), 0);
  }

  function closeRecoveryDialog() {
    if (elements.recoveryDialog.open) {
      elements.recoveryDialog.close();
    }
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault();
    if (state.recoveryBusy) {
      return;
    }

    const card = normalizeQueryCard(elements.recoveryValue.value);
    if (card.length < 4) {
      setInputError(
        elements.recoveryValue,
        elements.recoveryError,
        "请输入完整卡密，卡密仅包含英文字母和数字。",
      );
      elements.recoveryValue.focus();
      return;
    }
    if (state.locked && state.phase !== "gpt-poll") {
      elements.recoveryError.textContent =
        state.phase === "gpt-submit"
          ? "充值提交请求仍在等待返回，请暂时不要并行查询或关闭页面。"
          : "当前操作仍在处理中，请稍后再查询卡密状态。";
      return;
    }

    state.recoveryBusy = true;
    elements.recoveryClose.disabled = true;
    elements.recoveryValue.disabled = true;
    setInputError(elements.recoveryValue, elements.recoveryError, "");
    setButtonLoading(elements.recoverySubmit, true, "正在查询");
    setRecoveryResult(
      "loading",
      "正在查询卡密",
      "正在读取当前使用状态和绑定信息…",
    );

    try {
      const result = await requestJson("/api/cards/verify", {
        body: { cardInfo: card },
        timeoutMs: REQUEST_TIMEOUT,
      });
      const productId = Number(result.data.productId);
      const queryResult = normalizeCardQueryResult(result);

      if (
        Number.isInteger(productId) &&
        productId > 0 &&
        !isSupportedProductId(productId)
      ) {
        setRecoveryResult(
          "error",
          "该卡密不属于充值系统1",
          `充值系统1仅查询 GPT 商品 3 和商品 10；当前卡密属于商品 ${productId}。请切换到充值系统2查询。`,
        );
        return;
      }

      if (queryResult.kind === "used") {
        if (queryResult.boundEmail || queryResult.usedAt) {
          setRecoveryDetails(queryResult);
        } else {
          setRecoveryResult(
            "warning",
            "卡密已使用",
            "如有异常，刷新订阅或联系客服。",
          );
        }
        return;
      }

      if (["unused", "processing"].includes(queryResult.kind)) {
        setRecoveryDetails(queryResult);
        return;
      }

      const copy = queryResult.copy || errorCopy(result, "卡密查询失败");
      setRecoveryResult("error", copy.title, copy.detail);
    } catch (error) {
      if (!(error instanceof OperationCanceledError)) {
        setRecoveryResult(
          "warning",
          error instanceof RequestTimeoutError ? "本次查询超时" : "暂时无法连接服务",
          "没有取得最新状态。此次操作没有重新提交充值，请稍后再查询。",
        );
      }
    } finally {
      state.recoveryBusy = false;
      elements.recoveryClose.disabled = false;
      elements.recoveryValue.disabled = false;
      setButtonLoading(elements.recoverySubmit, false);
      syncRecoverySubmitState();
    }
  }

  async function resumeRecoveryCandidate() {
    if (state.locked || !state.recoveryCandidate) {
      return;
    }
    const candidate = state.recoveryCandidate;
    state.recoveryCandidate = null;
    closeRecoveryDialog();

    const runId = beginRun("gpt-poll");
    showTaskShell(
      "正在继续核对原卡密",
      "只会核对已经存在的充值进度，不会重新提交充值。",
      candidate.taskId,
      candidate.productId,
      1,
      true,
      { card: candidate.card, email: candidate.email },
    );
    try {
      const outcome = await pollGptTask(
        candidate.taskId,
        candidate.card,
        candidate.productId,
        runId,
        Date.now() + POLL_LIMIT,
      );
      assertRun(runId);
      renderPollOutcome(outcome);
    } catch (error) {
      if (!(error instanceof OperationCanceledError)) {
        finishTask(
          "warning",
          "状态核对已中断",
          "没有取得最新状态。请稍后用原卡密查询状态，不要重新提交充值。",
          "",
          1,
        );
      }
    } finally {
      candidate.card = "";
      endRun(runId);
    }
  }

  function stopPollingByUser() {
    if (!state.locked || state.phase !== "gpt-poll") {
      return;
    }
    state.userStopped = true;
    stopActiveRequests();
    state.runId += 1;
    state.phase = "idle";
    state.verified = null;
    setFlowLocked(false);
    elements.stopPolling.disabled = true;
    elements.stopPolling.hidden = true;
    elements.startOver.hidden = false;
    elements.taskStatusPill.textContent = "已暂停";
    elements.taskStatusPill.className = "status-pill status-warning";
    elements.taskProgress.className = "is-stopped";
    elements.taskTitle.textContent = "页面查询已停止";
    elements.taskSummary.textContent =
      "后台任务可能仍在处理。请勿重新提交，可稍后使用原卡密查询状态。";
    elements.taskUpdated.textContent = formatTime();
    clearCredentialFields();
    clearCardSecret();
    clearRecoveryCandidate();
    showNotice(
      "warning",
      "仅停止了页面查询",
      "此操作不会取消已经提交到服务端的任务。后台任务可能仍在处理，请勿重新提交。",
    );
  }

  elements.cardForm.addEventListener("submit", handleCardVerification);
  elements.cardInput.addEventListener("input", () => {
    if (!state.locked && !state.verified) {
      elements.verifyButton.disabled =
        normalizeCard(elements.cardInput.value).length < 4;
    }
  });
  elements.accountForm.addEventListener("submit", handleAccountSubmit);
  elements.credentialInput.addEventListener("input", handleCredentialInput);
  elements.reopenAccountConfirm.addEventListener("click", () => {
    openAccountConfirmation({ showErrors: true });
  });
  elements.accountConfirmCheckbox.addEventListener("change", () => {
    elements.accountConfirmSubmit.disabled = !elements.accountConfirmCheckbox.checked;
  });
  elements.accountConfirmSubmit.addEventListener("click", confirmAccountFromDialog);
  elements.accountConfirmCancel.addEventListener("click", closeAccountConfirmation);
  elements.accountConfirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAccountConfirmation();
  });
  elements.accountConfirmDialog.addEventListener("click", (event) => {
    if (event.target === elements.accountConfirmDialog) {
      closeAccountConfirmation();
    }
  });
  elements.accountConfirmDialog.addEventListener("close", () => {
    elements.accountConfirmCheckbox.checked = false;
    elements.accountConfirmSubmit.disabled = true;
    state.pendingAccountConfirmation = null;
  });
  elements.forceRecharge.addEventListener("change", () => {
    state.forceRechargeAutoChecked = false;
  });
  elements.backToCard.addEventListener("click", resetToCard);
  elements.stopPolling.addEventListener("click", stopPollingByUser);
  elements.startOver.addEventListener("click", resetToCard);
  $$("[data-open-recovery]").forEach((button) => {
    button.addEventListener("click", openRecoveryDialog);
  });
  elements.recoveryValue.addEventListener("input", () => {
    setInputError(elements.recoveryValue, elements.recoveryError, "");
    syncRecoverySubmitState();
  });
  elements.recoveryForm.addEventListener("submit", handleRecoverySubmit);
  elements.recoveryDialog.addEventListener("click", (event) => {
    if (event.target === elements.recoveryDialog && !state.recoveryBusy) {
      closeRecoveryDialog();
    }
  });
  elements.recoveryDialog.addEventListener("cancel", (event) => {
    if (state.recoveryBusy) {
      event.preventDefault();
    }
  });
  elements.recoveryDialog.addEventListener("close", () => {
    elements.recoveryValue.value = "";
    resetRecoveryPanel();
    syncRecoverySubmitState();
  });
  elements.openRefresh.addEventListener("click", openRefreshDialog);
  elements.refreshClose.addEventListener("click", closeRefreshDialog);
  elements.refreshBackdrop.addEventListener("mousedown", (event) => {
    if (event.target === elements.refreshBackdrop) {
      closeRefreshDialog();
    }
  });
  elements.refreshSession.addEventListener("input", () => {
    syncRefreshCount();
    if (!state.refreshBusy) {
      elements.refreshError.textContent = "";
      elements.refreshSession.removeAttribute("aria-invalid");
      showRefreshEmpty();
    }
  });
  elements.refreshClear.addEventListener("click", () => {
    if (state.refreshBusy) {
      return;
    }
    resetRefreshPanel();
    elements.refreshSession.focus();
  });
  elements.refreshForm.addEventListener("submit", handleRefreshSubmit);
  document.addEventListener("keydown", handleRefreshDialogKeydown);

  window.addEventListener("pagehide", () => {
    stopActiveRequests();
    if (state.refreshController) {
      state.refreshController.abort();
      state.refreshController = null;
    }
    clearCredentialFields();
    clearCardSecret();
    clearRecoveryCandidate();
    elements.recoveryValue.value = "";
    elements.refreshSession.value = "";
  });

  syncSystemSwitcherContext();
  resetRecoveryPanel();
  syncRecoverySubmitState();
  resetRefreshPanel();
  setFlowLocked(false);
})();
