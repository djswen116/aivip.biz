(() => {
  "use strict";

  const totalValidationUrl = new URL("../5.html", import.meta.url).href;

  function syncReturnValidationLink() {
    const returnLink = document.querySelector(".topnav .topnav-primary");
    if (!(returnLink instanceof HTMLAnchorElement)) {
      return;
    }

    if (returnLink.textContent.trim() !== "返回验证") {
      returnLink.textContent = "返回验证";
    }
    if (returnLink.href !== totalValidationUrl) {
      returnLink.href = totalValidationUrl;
    }

    if (returnLink.dataset.returnValidationBound === "true") {
      return;
    }

    returnLink.dataset.returnValidationBound = "true";
    returnLink.addEventListener(
      "click",
      (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.assign(totalValidationUrl);
      },
      { capture: true },
    );
  }

  function syncVerifiedCardLock() {
    const workspace = document.querySelector(".workspace");
    const cardInput = workspace?.querySelector("#card-code");
    const verifyButton = workspace?.querySelector('.code-form button[type="submit"]');
    if (
      !workspace ||
      !(cardInput instanceof HTMLInputElement) ||
      !(verifyButton instanceof HTMLButtonElement)
    ) {
      return;
    }

    const isVerified =
      !workspace.classList.contains("workspace-initial") &&
      Boolean(workspace.querySelector(".recharge-form"));

    if (isVerified) {
      cardInput.dataset.verifiedLock = "true";
      verifyButton.dataset.verifiedLock = "true";
      if (verifyButton.textContent.trim() !== "卡密验证通过") {
        verifyButton.textContent = "卡密验证通过";
      }
      if (!cardInput.disabled) {
        cardInput.disabled = true;
      }
      if (!verifyButton.disabled) {
        verifyButton.disabled = true;
      }
      return;
    }

    if (cardInput.dataset.verifiedLock === "true") {
      delete cardInput.dataset.verifiedLock;
      cardInput.disabled = false;
    }
    if (verifyButton.dataset.verifiedLock === "true") {
      delete verifyButton.dataset.verifiedLock;
      if (verifyButton.textContent.trim() === "卡密验证通过") {
        verifyButton.textContent = "验证卡密";
      }
      verifyButton.disabled = cardInput.value.replace(/[^a-z0-9]/gi, "").length < 4;
    }
  }

  function syncPage() {
    syncReturnValidationLink();
    syncVerifiedCardLock();
  }

  function start() {
    syncPage();
    const observer = new MutationObserver(syncPage);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "disabled", "href"],
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
