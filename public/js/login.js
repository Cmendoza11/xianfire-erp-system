(function () {
  const form = document.getElementById("adminLoginForm");
  const error = document.getElementById("login-error");

  form.addEventListener("xf:success", () => {
    window.location.href = form.dataset.redirect;
  });

  form.addEventListener("xf:error", (e) => {
    error.textContent = XF.errorMessage(e.detail, "Invalid email or password");
    error.classList.remove("hidden");
  });

  document.querySelector("[data-toggle-password]").addEventListener("click", (e) => {
    const input = document.getElementById("password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
})();
