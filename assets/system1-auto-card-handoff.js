import { startAutoCardHandoff } from "./auto-card-handoff.js?v=20260806-local-v7";

function clearOpenQuery() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", currentUrl.href);
}

function openRequestedNavigation() {
  if (new URL(window.location.href).searchParams.get("open") !== "refresh") {
    return false;
  }
  const refreshButton = document.querySelector("#open-subscription-refresh");
  if (!(refreshButton instanceof HTMLButtonElement)) {
    return false;
  }
  refreshButton.click();
  clearOpenQuery();
  return true;
}

function start() {
  if (openRequestedNavigation()) {
    return;
  }
  startAutoCardHandoff(1);
}

if (document.readyState === "complete") {
  start();
} else {
  window.addEventListener("load", start, { once: true });
}
