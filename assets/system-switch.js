(() => {
  "use strict";

  const scriptUrl = import.meta.url;
  const stylesheetUrl = new URL("system-switch.css?v=20260801-manual-refresh-v1", scriptUrl).href;
  const manualRefreshGuideUrl = new URL(
    "../subscription-refresh-guide.html?from=system2",
    scriptUrl,
  ).href;

  const sessionGuidancePlaceholder = `请粘贴完整的JSON数据，例如：
{
  "WARNING_BANNER": "……",
  "user": { "email": "name@example.com" },
  "account": { "id": "account_xxx" },
  "accessToken": "完整 accessToken"
}}}`;
  const sessionUseHelp = "上方仅为结构示意，请全选复制 Session 页面中的全部内容，不要增删任何字段。不要开网页翻译，会导致 Session 识别失败。";
  const sessionRefreshHelp = "上方仅为结构示意，请全选复制 Session 页面中的全部内容，不要增删任何字段。不要开网页翻译，会导致 Session 识别失败。";

  function ensureStylesheet() {
    if (document.querySelector('link[data-system-switch-styles]')) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = stylesheetUrl;
    link.dataset.systemSwitchStyles = "true";
    document.head.append(link);
  }

  function syncSessionGuidance() {
    const sessionInput = document.querySelector("#session-json");
    const refreshInput = document.querySelector("#subscription-refresh-session");
    const sessionHelp = document.querySelector("#session-json-help");
    const refreshHelp = document.querySelector("#subscription-refresh-help");

    for (const input of [sessionInput, refreshInput]) {
      if (input instanceof HTMLTextAreaElement && input.placeholder !== sessionGuidancePlaceholder) {
        input.placeholder = sessionGuidancePlaceholder;
      }
    }

    if (sessionHelp && sessionHelp.textContent !== sessionUseHelp) {
      sessionHelp.textContent = sessionUseHelp;
    }

    if (refreshHelp && refreshHelp.textContent !== sessionRefreshHelp) {
      refreshHelp.textContent = sessionRefreshHelp;
    }

    const detectedPlan = document.querySelector(
      "#session-confirm-dialog .email-confirm-meta > div:nth-child(2) dd",
    );
    if (detectedPlan?.textContent.trim() === "PLUS") {
      detectedPlan.textContent = "请确认为免费版";
    }

    const parsedPlan = document.querySelector(
      ".session-review-card .session-plan-type b",
    );
    if (parsedPlan?.textContent.trim() === "PLUS") {
      parsedPlan.textContent = "请确认为免费版";
    }
  }

  function buildUsedRefreshHint(scope) {
    const hint = document.createElement("p");
    hint.className = "system2-used-refresh-hint";
    hint.dataset.system2UsedRefreshHint = scope;
    hint.append(document.createTextNode("已完成升级，如有异常，"));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "system2-used-refresh-button";
    button.textContent = "请点此刷新订阅";
    button.addEventListener("click", () => {
      const refreshButton = document.querySelector(".topnav-refresh");
      if (refreshButton instanceof HTMLButtonElement) {
        refreshButton.click();
      }
    });

    hint.append(button);
    return hint;
  }

  function removeUsedRefreshHints(scope) {
    document
      .querySelectorAll(`[data-system2-used-refresh-hint="${scope}"]`)
      .forEach((hint) => hint.remove());
  }

  function syncUsedRefreshHints() {
    const verificationNotice = document.querySelector(
      "#recharge-card .notice.notice-warning",
    );
    const verificationTitle = verificationNotice?.querySelector(":scope > div > strong");
    const verificationCopy = verificationTitle?.parentElement;
    const verificationIsUsed = verificationTitle?.textContent.trim() === "卡密状态：已使用";

    if (verificationCopy && verificationIsUsed) {
      if (!verificationCopy.querySelector('[data-system2-used-refresh-hint="verification"]')) {
        verificationCopy.append(buildUsedRefreshHint("verification"));
      }
    } else {
      removeUsedRefreshHints("verification");
    }

    const queryResult = document.querySelector("#card-query-dialog .query-result");
    const queryGrid = queryResult?.querySelector(".query-result-grid");
    const queryStatus = queryResult?.querySelector(".query-result-heading .query-status");
    const queryIsUsed = queryStatus?.textContent.trim() === "已使用";

    if (queryResult && queryGrid && queryIsUsed) {
      let hint = queryResult.querySelector('[data-system2-used-refresh-hint="query"]');
      if (!hint) {
        hint = buildUsedRefreshHint("query");
      }
      if (queryGrid.nextElementSibling !== hint) {
        queryGrid.insertAdjacentElement("afterend", hint);
      }
    } else {
      removeUsedRefreshHints("query");
    }
  }

  function syncManualRefreshLink() {
    const resultRow = document.querySelector(
      "#subscription-refresh-dialog .refresh-result-table tbody tr",
    );
    const resultStatus = resultRow?.querySelector(".refresh-result-tag");
    const resultMessage = resultRow?.querySelector("td:nth-child(4)");

    if (!resultMessage || resultStatus?.textContent.trim() !== "刷新失败") {
      return;
    }

    const existingLink = resultMessage.querySelector("[data-manual-refresh-link]");
    if (existingLink) {
      return;
    }

    const manualRefreshLink = document.createElement("a");
    manualRefreshLink.className = "manual-refresh-link";
    manualRefreshLink.dataset.manualRefreshLink = "system2";
    manualRefreshLink.href = manualRefreshGuideUrl;
    manualRefreshLink.target = "_blank";
    manualRefreshLink.rel = "noopener noreferrer";
    manualRefreshLink.textContent = "请手动刷新订阅";
    resultMessage.replaceChildren(manualRefreshLink);
  }

  function syncPageEnhancements() {
    syncSessionGuidance();
    syncUsedRefreshHints();
    syncManualRefreshLink();
  }

  function start() {
    ensureStylesheet();
    syncPageEnhancements();
    const observer = new MutationObserver(syncPageEnhancements);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    let attempts = 0;
    const retry = window.setInterval(() => {
      attempts += 1;
      syncPageEnhancements();
      if (attempts >= 24) {
        window.clearInterval(retry);
      }
    }, 150);
  }

  function startWhenAppIsReady() {
    const deadline = Date.now() + 2500;

    function startHandoffIfRequested() {
      if (new URL(window.location.href).searchParams.get("handoff") !== "1") {
        return;
      }

      import("./auto-card-handoff.js?v=20260806-local-v7")
        .then(({ startAutoCardHandoff }) => startAutoCardHandoff(2))
        .catch(() => {});
    }

    function checkReadiness() {
      if (window.__VINEXT_HYDRATED_AT || Date.now() >= deadline) {
        start();
        startHandoffIfRequested();
        return;
      }

      window.setTimeout(checkReadiness, 100);
    }

    checkReadiness();
  }

  if (document.readyState === "complete") {
    startWhenAppIsReady();
  } else {
    window.addEventListener("load", startWhenAppIsReady, { once: true });
  }
})();
