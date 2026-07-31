(() => {
  "use strict";

  const scriptUrl = import.meta.url;
  const stylesheetUrl = new URL("system-switch.css?v=20260731-switch-v1", scriptUrl).href;
  const systemOneUrl = new URL("../5-system1.html", scriptUrl).href;
  const currentSystem = 2;
  const defaultSystem = 2;
  const targetSystem = 1;
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

  function buildSwitcher() {
    const bar = document.createElement("aside");
    bar.className = "system-switcher";
    bar.dataset.systemSwitcher = "true";
    bar.setAttribute("aria-label", "充值系统切换");

    const current = document.createElement("span");
    current.className = "system-switcher__current";
    const isDefault = currentSystem === defaultSystem;
    current.textContent = isDefault
      ? `当前默认：AI 充值系统${currentSystem}`
      : `当前：AI 充值系统${currentSystem}`;

    const systemOne = document.createElement("a");
    systemOne.className = "system-switcher__link";
    systemOne.href = systemOneUrl;
    systemOne.textContent = isDefault
      ? `切换到系统${targetSystem}`
      : `返回默认系统${defaultSystem}`;

    const arrow = document.createElement("span");
    arrow.className = "system-switcher__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    systemOne.append(arrow);

    bar.append(current, systemOne);
    return bar;
  }

  function buildSystemNotice() {
    const notice = document.createElement("div");
    notice.className = "system-switcher-notice";
    notice.dataset.systemSwitcherNotice = "true";
    notice.setAttribute("role", "status");
    notice.hidden = currentSystem === defaultSystem;

    const dot = document.createElement("span");
    dot.className = "system-switcher-notice__dot";
    dot.setAttribute("aria-hidden", "true");

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent =
      `现使用 AI 充值系统${currentSystem}，当前默认系统为 AI 充值系统${defaultSystem}`;
    const detail = document.createElement("span");
    detail.textContent = "若验证卡密提示“不存在”，通常是系统选错，请切换另一系统重试。";

    copy.append(title, detail);
    notice.append(dot, copy);
    return notice;
  }

  function mountSwitcher() {
    if (document.querySelector("[data-system-switcher]")) {
      return true;
    }

    const topbar = document.querySelector(".site-shell .topbar");
    if (!topbar) {
      return false;
    }

    const switcher = buildSwitcher();
    topbar.insertAdjacentElement("afterend", switcher);
    switcher.insertAdjacentElement("afterend", buildSystemNotice());
    return true;
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

  function start() {
    ensureStylesheet();
    syncSessionGuidance();
    const observer = new MutationObserver(syncSessionGuidance);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    let attempts = 0;
    mountSwitcher();

    const retry = window.setInterval(() => {
      attempts += 1;
      mountSwitcher();
      syncSessionGuidance();
      if (attempts >= 24) {
        window.clearInterval(retry);
      }
    }, 150);
  }

  function startWhenAppIsReady() {
    const deadline = Date.now() + 2500;

    function checkReadiness() {
      if (window.__VINEXT_HYDRATED_AT || Date.now() >= deadline) {
        start();
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
