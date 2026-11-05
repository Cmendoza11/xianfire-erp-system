(function () {
  const form = document.getElementById("adminSignupForm");
  const error = document.getElementById("signup-error");

  form.addEventListener("xf:success", () => {
    window.location.href = form.dataset.redirect;
  });

  form.addEventListener("xf:error", (e) => {
    error.textContent = XF.errorMessage(e.detail, "Unable to create the account");
    error.classList.remove("hidden");
  });
})();
