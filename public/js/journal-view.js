(function () {
  const button = document.querySelector("[data-delete-entry]");
  if (button) {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: `Delete ${button.dataset.entryNumber}`,
        content: "This permanently removes the entry and its lines from the ledger."
      });
      if (!confirmed) return;
      const result = await XF.api("DELETE", button.dataset.deleteEntry);
      if (result.ok) {
        window.location.href = button.dataset.gridUrl;
      } else {
        XF.toast("error", XF.errorMessage(result, "Unable to delete journal entry"));
      }
    });
  }

  const reverseForm = document.getElementById("reverseEntryForm");
  if (reverseForm) {
    // Ask before the shared JSON form handler sends the request.
    reverseForm.addEventListener(
      "submit",
      async (e) => {
        if (reverseForm.dataset.confirmed === "true") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const confirmed = await XF.confirm({
          heading: `Reverse ${reverseForm.dataset.entryNumber}`,
          content: "A new entry with swapped debits and credits will be posted on the selected date.",
          confirmText: "Reverse"
        });
        if (!confirmed) return;
        reverseForm.dataset.confirmed = "true";
        reverseForm.requestSubmit();
      },
      { capture: true }
    );
    reverseForm.addEventListener("xf:success", (e) => {
      XF.toast("success", "Reversing entry posted!");
      const view = e.detail?.data?.links?.find((link) => link.rel === "view");
      setTimeout(() => {
        window.location.href = view?.href || window.location.href;
      }, 800);
    });
    reverseForm.addEventListener("xf:error", () => {
      reverseForm.dataset.confirmed = "false";
    });
  }
})();
