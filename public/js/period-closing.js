(function () {
  const { closeApi, reopenApi } = document.currentScript.dataset;
  const retainedEarnings = document.querySelector("[data-retained-earnings]");

  async function run(api, body, successMessage) {
    const result = await XF.api("POST", api, body);
    if (result.ok) {
      XF.toast("success", successMessage);
      setTimeout(() => window.location.reload(), 800);
    } else {
      XF.toast("error", XF.errorMessage(result));
    }
  }

  document.querySelectorAll("[data-close-year]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!retainedEarnings.value) {
        XF.toast("error", "Select a retained earnings account first");
        return;
      }
      const label = retainedEarnings.selectedOptions[0].textContent;
      const confirmed = await XF.confirm({
        heading: `Close ${button.dataset.label}`,
        content: `Revenue and expense balances will be closed to ${label} with an entry dated ${button.dataset.end}, and the year will be locked.`,
        confirmText: "Close year"
      });
      if (!confirmed) return;
      XF.setLoading(button, true);
      await run(
        closeApi,
        { fiscal_year_start: button.dataset.closeYear, retained_earnings_account: retainedEarnings.value },
        `${button.dataset.label} closed`
      );
      XF.setLoading(button, false);
    });
  });

  document.querySelectorAll("[data-reopen-year]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: `Reopen ${button.dataset.label}`,
        content: "The closing entry will be deleted and the year unlocked so entries can be posted or corrected again.",
        confirmText: "Reopen"
      });
      if (!confirmed) return;
      XF.setLoading(button, true);
      await run(reopenApi, { fiscal_year_start: button.dataset.reopenYear }, `${button.dataset.label} reopened`);
      XF.setLoading(button, false);
    });
  });
})();
