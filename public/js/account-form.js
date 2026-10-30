(function () {
  const form = document.getElementById("accountingAccountForm");
  const type = form.querySelector("[data-account-type]");
  const normalBalance = form.querySelector("[name=normal_balance]");

  // Picking a type suggests its usual normal balance; contra accounts can still override it.
  type.addEventListener("change", () => {
    normalBalance.value = type.selectedOptions[0].dataset.normalBalance;
  });

  form.addEventListener("xf:success", () => {
    if (form.dataset.mode === "new") {
      XF.toast("success", "Account created successfully!");
      setTimeout(() => {
        window.location.href = form.dataset.gridUrl;
      }, 1000);
    } else {
      XF.toast("success", "Account saved successfully!");
    }
  });
})();
