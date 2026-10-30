(function () {
  const search = document.querySelector("[data-account-search]");
  const typeFilter = document.querySelector("[data-account-type-filter]");
  const rows = [...document.querySelectorAll("[data-account-row]")];
  const empty = document.querySelector("[data-account-empty]");

  function applyFilter() {
    const keyword = search.value.trim().toLowerCase();
    const type = typeFilter.value;
    let visible = 0;
    rows.forEach((row) => {
      const match =
        (!type || row.dataset.type === type) &&
        (!keyword ||
          row.dataset.code.toLowerCase().includes(keyword) ||
          row.dataset.name.toLowerCase().includes(keyword));
      row.classList.toggle("hidden", !match);
      if (match) visible++;
    });
    empty.classList.toggle("hidden", visible > 0);
  }

  search.addEventListener("input", applyFilter);
  typeFilter.addEventListener("change", applyFilter);

  document.querySelectorAll("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: `Delete account ${button.dataset.code}`,
        content: `Are you sure you want to delete ${button.dataset.name}?`
      });
      if (!confirmed) return;
      const result = await XF.api("DELETE", button.dataset.deleteAccount);
      if (result.ok) {
        window.location.reload();
      } else {
        XF.toast("error", XF.errorMessage(result, "Unable to delete account"));
      }
    });
  });
})();
