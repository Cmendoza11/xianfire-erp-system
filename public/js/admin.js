// Shared admin behaviour: toasts, confirm dialog, JSON API calls and JSON forms.
(function () {
  const XF = {};

  XF.toast = function (type, message) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  };

  // Resolves to { ok, status, body }; network failures resolve with ok=false instead of throwing.
  XF.api = async function (method, url, data) {
    const options = { method, headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (data !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(data);
    }
    try {
      const response = await fetch(url, options);
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.status === 401 && !url.includes("/user/login")) {
        window.location.href = "/admin/login";
      }
      return { ok: response.ok && !body?.error, status: response.status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  };

  XF.errorMessage = function (result, fallback) {
    return result?.body?.error?.message || fallback || "Something went wrong! Please try again.";
  };

  XF.confirm = function ({ heading, content, confirmText = "Delete", cancelText = "Cancel" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4";
      overlay.innerHTML = `
        <div class="card w-full max-w-md" role="dialog" aria-modal="true">
          <div class="card-header"><div class="card-title" data-heading></div></div>
          <div class="card-content text-sm text-gray-700" data-content></div>
          <div class="flex justify-end gap-2 px-5 pb-5">
            <button type="button" class="btn btn-secondary" data-cancel></button>
            <button type="button" class="btn btn-destructive" data-confirm></button>
          </div>
        </div>`;
      overlay.querySelector("[data-heading]").textContent = heading;
      overlay.querySelector("[data-content]").textContent = content;
      overlay.querySelector("[data-cancel]").textContent = cancelText;
      const confirmBtn = overlay.querySelector("[data-confirm]");
      confirmBtn.textContent = confirmText;
      const close = (value) => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(value);
      };
      const onKey = (e) => e.key === "Escape" && close(false);
      overlay.querySelector("[data-cancel]").addEventListener("click", () => close(false));
      overlay.addEventListener("click", (e) => e.target === overlay && close(false));
      confirmBtn.addEventListener("click", () => close(true));
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      confirmBtn.focus();
    });
  };

  XF.setLoading = function (button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.dataset.loading = loading ? "true" : "false";
  };

  function showFieldError(field, message) {
    field.classList.add("invalid");
    let error = field.parentElement.querySelector(".field-error");
    if (!error) {
      error = document.createElement("p");
      error.className = "field-error";
      field.parentElement.appendChild(error);
    }
    error.textContent = message;
  }

  function clearFieldError(field) {
    field.classList.remove("invalid");
    field.parentElement.querySelector(".field-error")?.remove();
  }

  // Validates [data-required] / [data-maxlength] fields; returns true when the form can be sent.
  XF.validateForm = function (form) {
    let valid = true;
    form.querySelectorAll("[name]:not([type=hidden]):not([type=checkbox])").forEach((field) => {
      clearFieldError(field);
      const value = field.value.trim();
      if (field.dataset.required && !value) {
        showFieldError(field, field.dataset.required);
        valid = false;
      } else if (field.dataset.maxlength && value.length > Number(field.dataset.maxlength)) {
        showFieldError(field, field.dataset.maxlengthMessage);
        valid = false;
      }
    });
    return valid;
  };

  // Later fields with the same name win, so a ticked checkbox overrides its hidden "0" twin.
  XF.formToJson = function (form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      data[key] = typeof value === "string" ? value : "";
    });
    return data;
  };

  // <form data-json-form data-method="PATCH" action="/api/..."> posts JSON and dispatches "xf:success".
  document.querySelectorAll("form[data-json-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!XF.validateForm(form)) return;
      const submitBtn = document.querySelector(`[form="${form.id}"][type="submit"]`) ||
        form.querySelector("[type=submit]");
      XF.setLoading(submitBtn, true);
      const result = await XF.api(form.dataset.method || "POST", form.getAttribute("action"), XF.formToJson(form));
      XF.setLoading(submitBtn, false);
      if (result.ok) {
        form.dispatchEvent(new CustomEvent("xf:success", { detail: result.body }));
      } else {
        form.dispatchEvent(new CustomEvent("xf:error", { detail: result }));
        if (!form.hasAttribute("data-custom-error")) {
          XF.toast("error", XF.errorMessage(result));
        }
      }
    });
    form.addEventListener("input", (e) => {
      if (e.target.classList.contains("invalid")) clearFieldError(e.target);
    });
  });

  // Declarative follow-up for JSON forms: data-success-message shows a toast, then
  // data-success-redirect goes to a URL, "view" (the saved record's viewUrl) or "reload".
  function afterSuccess(el, body) {
    if (el.dataset.successMessage) XF.toast("success", el.dataset.successMessage);
    const target = el.dataset.successRedirect;
    if (!target) return;
    const href = target === "reload" ? window.location.href : target === "view" ? body?.data?.viewUrl : target;
    setTimeout(() => {
      window.location.href = href || window.location.href;
    }, 800);
  }

  document.querySelectorAll("form[data-json-form][data-success-message], form[data-json-form][data-success-redirect]")
    .forEach((form) => form.addEventListener("xf:success", (e) => afterSuccess(form, e.detail)));

  // <button data-api-action="/api/..." data-method="POST" data-confirm-heading="..."> calls an
  // endpoint after an optional confirmation. data-payload holds JSON; data-payload-from names a
  // form whose fields are sent instead.
  document.querySelectorAll("[data-api-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const d = button.dataset;
      if (d.confirmHeading) {
        const confirmed = await XF.confirm({
          heading: d.confirmHeading,
          content: d.confirmContent || "",
          confirmText: d.confirmLabel || "Confirm"
        });
        if (!confirmed) return;
      }
      let payload = d.payload ? JSON.parse(d.payload) : undefined;
      if (d.payloadFrom) {
        const form = document.getElementById(d.payloadFrom);
        if (!XF.validateForm(form)) return;
        payload = XF.formToJson(form);
      }
      XF.setLoading(button, true);
      const result = await XF.api(d.method || "POST", d.apiAction, payload);
      XF.setLoading(button, false);
      if (result.ok) afterSuccess(button, result.body);
      else XF.toast("error", XF.errorMessage(result));
    });
  });

  // Header account dropdown
  document.querySelectorAll("[data-dropdown]").forEach((dropdown) => {
    const menu = dropdown.querySelector("[data-dropdown-menu]");
    dropdown.querySelector("[data-dropdown-toggle]").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menu.classList.add("hidden"));
  });

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await XF.api("GET", button.dataset.logout);
      if (result.status === 200) {
        window.location.href = button.dataset.loginUrl;
      } else {
        XF.toast("error", "Logout failed");
      }
    });
  });

  document.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => window.print());
  });

  document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("[data-nav]")?.classList.toggle("hidden");
    });
  });

  window.XF = XF;
})();
