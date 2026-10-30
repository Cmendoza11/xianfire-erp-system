(function () {
  const { toggleApi } = document.currentScript.dataset;
  const formatter = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n) => (n < 0 ? `(${formatter.format(Math.abs(n))})` : formatter.format(n));
  const cleared = document.querySelector("[data-cleared-balance]");
  const difference = document.querySelector("[data-difference]");
  const complete = document.querySelector("[data-complete-rec]");

  // Each tick is saved immediately, so a reconciliation can be finished later.
  document.querySelectorAll("[data-rec-line]").forEach((box) => {
    box.addEventListener("change", async () => {
      box.disabled = true;
      const result = await XF.api("PATCH", toggleApi, { line: Number(box.dataset.recLine), cleared: box.checked });
      box.disabled = false;
      if (!result.ok) {
        box.checked = !box.checked;
        XF.toast("error", XF.errorMessage(result));
        return;
      }
      const data = result.body.data;
      cleared.textContent = signed(data.clearedBalance);
      difference.textContent = signed(data.difference);
      difference.classList.toggle("text-destructive", !data.canComplete);
      if (complete) complete.disabled = !data.canComplete;
    });
  });
})();
