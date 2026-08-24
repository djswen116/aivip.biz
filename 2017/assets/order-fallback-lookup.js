const PLAN_LABELS = {
  plus: "Plus",
  pro5: "Pro 5X",
  pro20: "Pro 20X",
};

const STATUS_LABELS = {
  pending: { label: "等待处理", tone: "warning" },
  processing: { label: "处理中", tone: "info" },
  success: { label: "充值成功", tone: "success" },
  failed: { label: "充值失败", tone: "danger" },
};

const lookupState = {
  cardNumber: "",
  email: "",
  status: "idle",
  message: "",
  messageType: "",
  results: [],
};

function getErrorMessage(payload, fallback = "查询失败，请稍后重试") {
  if (payload?.detail) {
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item?.msg).filter(Boolean).join("；") || fallback;
    }
    if (typeof payload.detail === "string") return payload.detail;
  }
  return payload?.message || fallback;
}

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

function renderResultCard(order) {
  const article = createElement("article", "fallback-result-card");
  const header = createElement("div", "fallback-result-header");
  const status = STATUS_LABELS[order.status] || {
    label: order.status || "未知状态",
    tone: "neutral",
  };
  const statusPill = createElement("span", `status-pill ${status.tone}`);
  statusPill.append(createElement("span"), document.createTextNode(status.label));
  header.append(statusPill, createElement("strong", "", order.email || "未知账号"));

  const details = createElement("dl", "fallback-result-details");
  const rows = [
    ["套餐", PLAN_LABELS[order.plan_type] || order.plan_type || "—"],
    ["订单号", order.order_no || "—"],
    ["支付金额", order.payment_amount
      ? `${order.payment_amount} ${order.payment_currency || ""}`.trim()
      : "等待生成"],
    ["重试次数", `${order.retry_attempt || 1} / 3`],
  ];

  for (const [label, value] of rows) {
    const row = createElement("div");
    row.append(createElement("dt", "", label), createElement("dd", "", value));
    details.append(row);
  }

  article.append(header, details);

  if (order.card_key) {
    const copyButton = createElement("button", "fallback-copy-key");
    copyButton.type = "button";
    copyButton.append(
      createElement("span", "", order.card_key),
      createElement("strong", "", "复制查询卡密"),
    );
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(order.card_key);
        lookupState.message = "查询卡密已复制，可粘贴到上方继续查询";
        lookupState.messageType = "success";
      } catch {
        lookupState.message = "复制失败，请手动选择查询卡密";
        lookupState.messageType = "error";
      }
      renderMountedLookup();
    });
    article.append(copyButton);
  }

  if (order.failure_reason) {
    article.append(createElement("p", "fallback-failure-reason", order.failure_reason));
  }

  return article;
}

function renderLookup(section) {
  const cardInput = section.querySelector("[data-lookup-card]");
  const emailInput = section.querySelector("[data-lookup-email]");
  const submitButton = section.querySelector("[data-lookup-submit]");
  const feedback = section.querySelector("[data-lookup-feedback]");
  const results = section.querySelector("[data-lookup-results]");
  section.querySelector(".fallback-summary-action").textContent = section.open ? "收起" : "展开";

  if (cardInput.value !== lookupState.cardNumber) cardInput.value = lookupState.cardNumber;
  if (emailInput.value !== lookupState.email) emailInput.value = lookupState.email;

  const isLoading = lookupState.status === "loading";
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "正在查询…" : "按卡号和邮箱查询";

  feedback.hidden = !lookupState.message;
  feedback.className = `fallback-lookup-feedback ${lookupState.messageType || ""}`.trim();
  feedback.textContent = lookupState.message;

  results.replaceChildren(...lookupState.results.map(renderResultCard));
  results.hidden = lookupState.results.length === 0;
}

function renderMountedLookup() {
  const section = document.querySelector(".order-fallback-lookup");
  if (section) renderLookup(section);
}

async function submitLookup(event) {
  event.preventDefault();

  const apiKey = document.querySelector("#api-key")?.value?.trim() || "";
  const cardNumber = lookupState.cardNumber.replace(/[\s-]/g, "");
  const email = lookupState.email.trim();

  lookupState.cardNumber = cardNumber;
  lookupState.email = email;
  lookupState.results = [];

  if (!apiKey) {
    lookupState.message = "请先在主页面填写 API Key";
    lookupState.messageType = "error";
    renderMountedLookup();
    return;
  }
  if (!/^\d{12,19}$/.test(cardNumber)) {
    lookupState.message = "银行卡号应为 12-19 位数字";
    lookupState.messageType = "error";
    renderMountedLookup();
    return;
  }
  if (!email || email.length > 255) {
    lookupState.message = "请输入正确的充值邮箱";
    lookupState.messageType = "error";
    renderMountedLookup();
    return;
  }

  lookupState.status = "loading";
  lookupState.message = "正在从平台补查最新订单…";
  lookupState.messageType = "info";
  renderMountedLookup();

  try {
    const response = await fetch("/local-api/orders/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, cardNumber, email }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.code !== 0) {
      throw new Error(getErrorMessage(payload));
    }

    lookupState.results = Array.isArray(payload.data) ? payload.data : [];
    lookupState.message = lookupState.results.length > 0
      ? `已找到 ${lookupState.results.length} 条最新业务订单`
      : "没有找到匹配订单";
    lookupState.messageType = lookupState.results.length > 0 ? "success" : "info";
    lookupState.status = "success";
  } catch (error) {
    lookupState.status = "error";
    lookupState.message = error instanceof Error ? error.message : "查询失败，请稍后重试";
    lookupState.messageType = "error";
  }

  renderMountedLookup();
}

function mountLookup() {
  const panel = document.querySelector(".order-panel");
  if (!panel || panel.querySelector(".order-fallback-lookup")) return;

  const manualLookup = panel.querySelector(".manual-lookup");
  const ordersList = panel.querySelector(".orders-list");
  if (!manualLookup || !ordersList) return;

  const section = createElement("details", "order-fallback-lookup");
  if (lookupState.status !== "idle") section.open = true;
  section.innerHTML = `
    <summary>
      <span>
        <strong>没有查询卡密？</strong>
        <small>使用支付卡号和充值邮箱补查</small>
      </span>
      <span class="fallback-summary-action">展开</span>
    </summary>
    <form class="fallback-lookup-form" novalidate>
      <label>
        <span>支付银行卡号</span>
        <input data-lookup-card type="text" inputmode="numeric" autocomplete="off"
          spellcheck="false" placeholder="12-19 位卡号" />
      </label>
      <label>
        <span>充值邮箱</span>
        <input data-lookup-email type="email" autocomplete="off" spellcheck="false"
          placeholder="user@example.com" />
      </label>
      <p class="fallback-lookup-help">仅用于本次查询，不写入本地存储；卡号中的空格和短横线会自动去除。</p>
      <button data-lookup-submit type="submit">按卡号和邮箱查询</button>
      <p data-lookup-feedback class="fallback-lookup-feedback" role="status" aria-live="polite" hidden></p>
      <div data-lookup-results class="fallback-lookup-results" hidden></div>
    </form>
  `;

  const cardInput = section.querySelector("[data-lookup-card]");
  const emailInput = section.querySelector("[data-lookup-email]");
  cardInput.addEventListener("input", () => { lookupState.cardNumber = cardInput.value; });
  emailInput.addEventListener("input", () => { lookupState.email = emailInput.value; });
  section.querySelector("form").addEventListener("submit", submitLookup);
  section.addEventListener("toggle", () => {
    const action = section.querySelector(".fallback-summary-action");
    action.textContent = section.open ? "收起" : "展开";
  });

  panel.insertBefore(section, ordersList);
  renderLookup(section);
}

const observer = new MutationObserver(mountLookup);
observer.observe(document.documentElement, { childList: true, subtree: true });
mountLookup();
