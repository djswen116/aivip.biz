(function () {
  if (window.__contactQrModalReady) return;
  window.__contactQrModalReady = true;

  const defaultMessage = "客服每日15小时在线，微信和 QQ 同号：82765536";
  let modal;

  function ensureModal() {
    modal = document.querySelector("[data-contact-qr-modal]");
    if (modal) return modal;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="contact-qr-modal" data-contact-qr-modal hidden role="dialog" aria-modal="true" aria-labelledby="contactQrTitle">
        <div class="contact-qr-dialog">
          <button class="contact-qr-close" type="button" data-contact-qr-close aria-label="关闭">×</button>
          <h2 id="contactQrTitle">联系客服</h2>
          <p data-contact-qr-message>${defaultMessage}</p>
          <img src="assets/contact-qrcode.png" alt="文文AI 微信二维码" class="contact-qr-image" loading="lazy" decoding="async">
        </div>
      </div>
    `.trim();
    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  function openModal(text = defaultMessage) {
    const modal = ensureModal();
    const message = modal.querySelector("[data-contact-qr-message]");
    if (message) message.textContent = text;
    modal.hidden = false;
    const closeButton = modal.querySelector("[data-contact-qr-close]");
    if (closeButton) closeButton.focus();
  }

  window.showContactQrModal = openModal;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-contact-qr-open]");
    if (!trigger) return;
    event.preventDefault();
    openModal(trigger.dataset.contactQrMessage || defaultMessage);
  });

  document.addEventListener("click", (event) => {
    const activeModal = document.querySelector("[data-contact-qr-modal]");
    if (!activeModal || activeModal.hidden) return;
    if (event.target === activeModal || event.target.closest("[data-contact-qr-close]")) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
})();
