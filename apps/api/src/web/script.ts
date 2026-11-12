// Progressive enhancement: without this script every form still submits normally. With it, a form marked
// data-busy shows the overlay and locks all action buttons, so a slow Hostinger call cannot be fired twice.
export const APP_JS = `(() => {
  const overlay = () => document.querySelector(".busy");

  function reset() {
    document.body.classList.remove("is-busy");
    const box = overlay();
    if (box) box.hidden = true;
    for (const button of document.querySelectorAll("form[data-busy] button")) {
      button.disabled = false;
      if (button.dataset.label) {
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      }
    }
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.busy) return;
    if (document.body.classList.contains("is-busy")) {
      event.preventDefault();
      return;
    }
    document.body.classList.add("is-busy");
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : form.querySelector("button");
    if (button) {
      button.dataset.label = button.textContent;
      button.textContent = "Memproses…";
    }
    const box = overlay();
    if (box) {
      box.querySelector(".busy-text").textContent = form.dataset.busy;
      box.hidden = false;
    }
    // Disabled after the submit event has run, so the submission itself is not cancelled.
    setTimeout(() => {
      for (const other of document.querySelectorAll("form[data-busy] button")) other.disabled = true;
    }, 0);
  });

  // Back returns to the list the owner came from (keeping its search and page); opened directly, the link's own
  // href is followed instead, so it never leaves the dashboard.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[data-back]") : null;
    if (!link || history.length < 2 || !document.referrer.startsWith(location.origin + "/")) return;
    event.preventDefault();
    history.back();
  });

  // Coming back with the browser's Back button restores the page from cache with the overlay still showing.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reset();
  });
})();
`;
