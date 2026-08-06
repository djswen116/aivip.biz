const HANDOFF_KEY = "aivip:auto-card-handoff:v1";
const HANDOFF_MAX_AGE = 2 * 60_000;
const MAX_ATTEMPTS = 80;
const RETRY_DELAY = 100;
const reactReadyTimes = new WeakMap();

function normalizeCard(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function readHandoff(targetSystem) {
  if (new URL(window.location.href).searchParams.get("handoff") !== "1") {
    return null;
  }

  let handoff = null;
  try {
    handoff = JSON.parse(window.sessionStorage.getItem(HANDOFF_KEY) || "null");
  } catch {
    window.sessionStorage.removeItem(HANDOFF_KEY);
    return null;
  }

  const card = normalizeCard(handoff && handoff.card);
  const system = Number(handoff && handoff.system);
  const action = handoff && handoff.action === "query" ? "query" : "verify";
  const createdAt = Number(handoff && handoff.createdAt);
  const isFresh = Number.isFinite(createdAt) && Date.now() - createdAt <= HANDOFF_MAX_AGE;

  if (!card || system !== targetSystem || !isFresh) {
    window.sessionStorage.removeItem(HANDOFF_KEY);
    return null;
  }
  return { action, card, system };
}

function clearHandoffQuery() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("handoff");
  window.history.replaceState(window.history.state, "", currentUrl.href);
}

function setNativeInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor && typeof descriptor.set === "function") {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isOriginalFormReady(input, targetSystem) {
  if (targetSystem !== 2) {
    return true;
  }

  const isReactManaged = Object.keys(input).some(
    (key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$"),
  );
  if (!isReactManaged) {
    return false;
  }

  const readyAt = reactReadyTimes.get(input) || 0;
  if (!readyAt) {
    reactReadyTimes.set(input, Date.now());
    return false;
  }

  return Date.now() - readyAt >= 750;
}

export function startAutoCardHandoff(targetSystem) {
  if (![1, 2].includes(Number(targetSystem))) {
    return;
  }

  const handoff = readHandoff(Number(targetSystem));
  if (!handoff) {
    return;
  }

  let attempts = 0;
  let finished = false;
  let queryDialogOpened = false;
  let retryId = 0;

  function targetInput() {
    if (handoff.action === "query") {
      return document.querySelector(targetSystem === 1 ? "#recovery-value" : "#query-card-code");
    }
    return document.querySelector("#card-code");
  }

  function openQueryDialog() {
    if (handoff.action !== "query" || queryDialogOpened) {
      return true;
    }
    const openButton = document.querySelector(
      targetSystem === 1 ? "[data-open-recovery]" : ".topnav-query",
    );
    if (!(openButton instanceof HTMLButtonElement)) {
      return false;
    }
    openButton.click();
    queryDialogOpened = true;
    return false;
  }

  function finish({ submitted }) {
    if (finished) {
      return;
    }
    finished = true;
    window.clearTimeout(retryId);
    window.sessionStorage.removeItem(HANDOFF_KEY);
    clearHandoffQuery();

    if (!submitted) {
      const input = targetInput();
      if (input instanceof HTMLInputElement) {
        setNativeInputValue(input, handoff.card);
        input.focus();
      }
    }
  }

  function trySubmit() {
    if (finished) {
      return;
    }
    attempts += 1;

    if (!openQueryDialog()) {
      retryId = window.setTimeout(trySubmit, RETRY_DELAY);
      return;
    }

    const input = targetInput();
    const form = input instanceof HTMLInputElement ? input.closest("form") : null;
    const submit = form?.querySelector('button[type="submit"]');

    if (
      input instanceof HTMLInputElement &&
      form instanceof HTMLFormElement &&
      submit instanceof HTMLButtonElement &&
      isOriginalFormReady(input, Number(targetSystem))
    ) {
      setNativeInputValue(input, handoff.card);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (finished || !input.isConnected || !form.isConnected) {
            return;
          }
          if (!submit.disabled && !form.dataset.autoCardHandoffSubmitted) {
            form.dataset.autoCardHandoffSubmitted = "true";
            finish({ submitted: true });
            form.requestSubmit(submit);
            return;
          }
          if (attempts >= MAX_ATTEMPTS) {
            finish({ submitted: false });
            return;
          }
          retryId = window.setTimeout(trySubmit, RETRY_DELAY);
        });
      });
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      finish({ submitted: false });
      return;
    }
    retryId = window.setTimeout(trySubmit, RETRY_DELAY);
  }

  trySubmit();
}
