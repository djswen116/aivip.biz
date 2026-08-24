const MEMBER_PLAN_TYPES = new Set(["plus", "pro", "prolite", "team"]);

const MEMBER_PLAN_LABELS = {
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
};

let activeConfirmation = null;

function normalizePlanType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseCard(value) {
  const input = value.trim();
  if (!input) return null;

  let cardNumber;
  let expMonth;
  let expYear;
  let cvv;

  if (input.includes("|")) {
    [cardNumber, expMonth, expYear, cvv] = input.split("|").map((part) => part.trim());
  } else {
    const parts = input.split("---").map((part) => part.trim());
    if (parts.length !== 3) return null;
    [cardNumber, cvv] = [parts[0], parts[2]];
    [expMonth, expYear] = parts[1].split("/").map((part) => part.trim());
  }

  cardNumber = (cardNumber || "").replace(/\s/g, "");
  if (!/^\d{12,19}$/.test(cardNumber)) return null;
  if (!/^\d{1,2}$/.test(expMonth || "")) return null;
  if (!/^\d{2,4}$/.test(expYear || "")) return null;
  if (!/^\d{3,4}$/.test(cvv || "")) return null;

  const month = Number(expMonth);
  const year = Number(expYear) < 100 ? 2000 + Number(expYear) : Number(expYear);
  const now = new Date();

  if (month < 1 || month > 12 || year < 2000 || year > 9999) return null;
  if (year < now.getFullYear()) return null;
  if (year === now.getFullYear() && month < now.getMonth() + 1) return null;

  return { cardNumber, month, year, cvv };
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function parseValidSession(value) {
  if (!value.trim()) return null;

  try {
    const session = JSON.parse(value);
    if (!session || Array.isArray(session) || typeof session !== "object") return null;
    if (typeof session.user?.email !== "string" || !session.user.email.trim()) return null;
    if (typeof session.account?.id !== "string" || !session.account.id.trim()) return null;
    if (typeof session.accessToken !== "string" || !session.accessToken.trim()) return null;
    if (session.sessionToken !== undefined && typeof session.sessionToken !== "string") return null;

    const payload = decodeJwtPayload(session.accessToken);
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;
    if (payload.iat > now + 300 || payload.exp <= now) return null;

    return {
      planType: normalizePlanType(session.account.planType),
      email: session.user.email.trim(),
    };
  } catch {
    return null;
  }
}

function hasInvalidSessionTokenType(value) {
  try {
    const session = JSON.parse(value);
    return Boolean(
      session
      && !Array.isArray(session)
      && typeof session === "object"
      && session.sessionToken !== undefined
      && typeof session.sessionToken !== "string"
    );
  } catch {
    return false;
  }
}

function showSessionTokenTypeError() {
  const textarea = document.querySelector("#session-json");
  if (!textarea) return;

  document.querySelector(".session-token-type-error")?.remove();
  const error = document.createElement("p");
  error.className = "inline-error session-token-type-error";
  error.setAttribute("role", "alert");
  error.textContent = "Session JSON 中的 sessionToken 必须是字符串";
  textarea.insertAdjacentElement("afterend", error);
  textarea.classList.add("is-invalid");
  textarea.focus();
}

function maskRecognizedPaymentFields() {
  for (const row of document.querySelectorAll(".recognition-grid > div")) {
    const label = row.querySelector("span")?.textContent?.trim();
    const value = row.querySelector("strong");
    if (!value) continue;

    const digits = value.textContent.replace(/\s/g, "");
    if (label === "卡号" && /^\d{12,19}$/.test(digits)) {
      value.textContent = `•••• •••• •••• ${digits.slice(-4)}`;
    } else if (label === "CVV" && /^\d{3,4}$/.test(digits)) {
      value.textContent = "•".repeat(digits.length);
    }
  }
}

function getSelectedTargetPlan() {
  return document.querySelector(".plan-card.is-selected strong")?.textContent?.trim() || "当前所选套餐";
}

function closeConfirmation({ restoreFocus = true } = {}) {
  if (!activeConfirmation) return;

  const { backdrop, keydownHandler, triggerButton, appRoot } = activeConfirmation;
  document.removeEventListener("keydown", keydownHandler);
  backdrop.remove();
  if (appRoot) appRoot.inert = false;
  activeConfirmation = null;

  if (restoreFocus && triggerButton.isConnected) triggerButton.focus();
}

function openConfirmation({ triggerButton, planType }) {
  if (activeConfirmation) return;

  const appRoot = document.querySelector("#root");
  const backdrop = document.createElement("div");
  backdrop.className = "membership-confirm-backdrop";

  const dialog = document.createElement("section");
  dialog.className = "membership-confirm-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "membership-confirm-title");
  dialog.setAttribute("aria-describedby", "membership-confirm-description");

  dialog.innerHTML = `
    <header class="membership-confirm-header">
      <span class="membership-confirm-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 3.4 21 19a1.1 1.1 0 0 1-1 1.6H4A1.1 1.1 0 0 1 3 19l9-15.6Z"></path>
          <path d="M12 8.3v5.8M12 17.2h.01"></path>
        </svg>
      </span>
      <div>
        <h2 id="membership-confirm-title">检测到账号已有会员套餐</h2>
        <p id="membership-confirm-description">当前 Session 不是 Free 账户。继续充值前，请再次确认。</p>
      </div>
      <button class="membership-confirm-close" type="button" aria-label="关闭确认弹窗">×</button>
    </header>
    <div class="membership-confirm-body">
      <dl class="membership-confirm-summary">
        <div>
          <dt>当前 Session 套餐</dt>
          <dd data-current-plan></dd>
        </div>
        <div>
          <dt>本次充值套餐</dt>
          <dd data-target-plan></dd>
        </div>
      </dl>
      <p class="membership-confirm-warning">
        继续操作可能产生重复充值或套餐冲突。请确认账号和目标套餐无误后再继续。
      </p>
    </div>
    <footer class="membership-confirm-actions">
      <button class="membership-confirm-cancel" type="button">返回检查</button>
      <button class="membership-confirm-proceed" type="button">确认继续充值</button>
    </footer>
  `;

  backdrop.append(dialog);
  document.body.append(backdrop);
  if (appRoot) appRoot.inert = true;

  dialog.querySelector("[data-current-plan]").textContent = MEMBER_PLAN_LABELS[planType] || planType;
  dialog.querySelector("[data-target-plan]").textContent = `ChatGPT ${getSelectedTargetPlan()}`;

  const cancelButton = dialog.querySelector(".membership-confirm-cancel");
  const proceedButton = dialog.querySelector(".membership-confirm-proceed");
  const closeButton = dialog.querySelector(".membership-confirm-close");

  const keydownHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = [closeButton, cancelButton, proceedButton];
    const currentIndex = focusable.indexOf(document.activeElement);

    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      proceedButton.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      closeButton.focus();
    }
  };

  activeConfirmation = { backdrop, keydownHandler, triggerButton, appRoot };
  document.addEventListener("keydown", keydownHandler);

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeConfirmation();
  });
  closeButton.addEventListener("click", () => closeConfirmation());
  cancelButton.addEventListener("click", () => closeConfirmation());
  proceedButton.addEventListener("click", () => {
    triggerButton.dataset.membershipConfirmBypass = "true";
    closeConfirmation({ restoreFocus: false });
    triggerButton.click();
  });

  cancelButton.focus();
}

document.addEventListener(
  "click",
  (event) => {
    const clickedElement = event.target instanceof Element ? event.target : null;
    const triggerButton = clickedElement?.closest(".action-bar .primary-button");

    if (!triggerButton || !triggerButton.textContent.includes("立即充值")) return;

    if (triggerButton.dataset.membershipConfirmBypass === "true") {
      delete triggerButton.dataset.membershipConfirmBypass;
      return;
    }

    const apiKey = document.querySelector("#api-key")?.value || "";
    const cardValue = document.querySelector("#card-info")?.value || "";
    const sessionValue = document.querySelector("#session-json")?.value || "";
    if (hasInvalidSessionTokenType(sessionValue)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showSessionTokenTypeError();
      return;
    }
    const session = parseValidSession(sessionValue);

    if (!apiKey.trim() || !parseCard(cardValue) || !session) return;
    if (!MEMBER_PLAN_TYPES.has(session.planType)) return;

    event.preventDefault();
    event.stopPropagation();
    openConfirmation({ triggerButton, planType: session.planType });
  },
  true,
);

document.addEventListener("input", (event) => {
  if (event.target?.id === "session-json") {
    document.querySelector(".session-token-type-error")?.remove();
  }
  if (event.target?.id === "card-info") {
    queueMicrotask(maskRecognizedPaymentFields);
  }
});

const paymentMaskObserver = new MutationObserver(maskRecognizedPaymentFields);
const appRoot = document.querySelector("#root");
if (appRoot) {
  paymentMaskObserver.observe(appRoot, { childList: true, characterData: true, subtree: true });
  maskRecognizedPaymentFields();
}
