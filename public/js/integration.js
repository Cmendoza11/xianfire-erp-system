// ERP integration form: shows a newly generated API key once, and replaces a key on request.
(function () {
  const XF = window.XF;
  const form = document.getElementById("integrationForm");
  const panel = document.getElementById("apiKeyPanel");
  const keyInput = document.getElementById("apiKeyValue");

  function showKey(apiKey) {
    keyInput.value = apiKey;
    panel.classList.remove("hidden");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    keyInput.select();
  }

  // A new integration: hide the form so it cannot be submitted twice, then show the key.
  form.addEventListener("xf:success", (e) => {
    if (form.dataset.method !== "POST") return;
    form.classList.add("hidden");
    showKey(e.detail?.data?.apiKey ?? "");
  });

  document.querySelector("[data-copy-key]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(keyInput.value);
      XF.toast("success", "API key copied");
    } catch {
      keyInput.select();
      XF.toast("error", "Copy failed; select the key and copy it manually");
    }
  });

  document.querySelectorAll("[data-rotate-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: "Generate a new API key?",
        content: "The current key stops working immediately. The connected system must be updated with the new key.",
        confirmText: "Generate new key"
      });
      if (!confirmed) return;
      XF.setLoading(button, true);
      const result = await XF.api("POST", button.dataset.rotateKey, {});
      XF.setLoading(button, false);
      if (result.ok) showKey(result.body.data.apiKey);
      else XF.toast("error", XF.errorMessage(result));
    });
  });
})();
