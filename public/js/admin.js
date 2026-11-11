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
      overlay.className = "fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4";
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

  // The rail picks which section the panel lists.
  const nav = document.querySelector("[data-nav]");
  if (nav) {
    const sections = [...nav.querySelectorAll("[data-nav-group]")];
    const railItems = [...nav.querySelectorAll(".rail-item")];
    const showSection = (key) => {
      sections.forEach((section) => { section.hidden = section.dataset.navGroup !== key; });
      railItems.forEach((item) => {
        const active = (item.dataset.navSection ?? "home") === key;
        item.classList.toggle("active", active);
        if (item.tagName === "BUTTON") item.setAttribute("aria-pressed", String(active));
      });
    };
    railItems.filter((item) => item.tagName === "BUTTON").forEach((button) => {
      button.addEventListener("click", () => showSection(button.dataset.navSection));
    });
    showSection(nav.dataset.navActive);
  }

  // Theme: light, dark or the system setting. partials/head.xian applies the saved choice before first paint.
  const THEME_KEY = "xf-theme";
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const savedTheme = () => {
    try {
      return localStorage.getItem(THEME_KEY) || "system";
    } catch {
      return "system";
    }
  };
  const applyTheme = (choice) => {
    const dark = choice === "dark" || (choice === "system" && systemDark.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const on = button.dataset.themeChoice === choice;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  };
  XF.setTheme = (choice) => {
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      // Storage can be blocked; the theme still applies to this page.
    }
    applyTheme(choice);
  };
  systemDark.addEventListener("change", () => {
    if (savedTheme() === "system") applyTheme("system");
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation(); // keeps the account menu open while choosing
      XF.setTheme(button.dataset.themeChoice);
    });
  });
  applyTheme(savedTheme());

  // Command palette: every page in the menu plus a few actions. Opens with Ctrl+K / Cmd+K, "/" or a search button.
  const panel = document.querySelector(".app-panel");
  if (panel) {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    document.querySelectorAll("[data-shortcut-label]").forEach((label) => { label.textContent = isMac ? "⌘K" : "Ctrl K"; });

    let overlay = null;
    let input = null;
    let list = null;
    let empty = null;
    let commands = [];
    let results = [];
    let active = 0;
    let returnFocus = null;

    const buildCommands = () => {
      const seen = new Set();
      const pages = [];
      // Dashboard shortcuts repeat links from other sections, so each page is listed once under its own section.
      panel.querySelectorAll("a[href]").forEach((link) => {
        if (link.closest("[data-nav-shortcuts]") || seen.has(link.href)) return;
        seen.add(link.href);
        const heading = link.closest("ul")?.previousElementSibling;
        pages.push({
          label: link.textContent.trim(),
          hint: heading?.classList.contains("nav-group") ? heading.textContent.trim() : "Action",
          run: () => { window.location.href = link.href; }
        });
      });
      const password = document.querySelector(".account-menu a[href]");
      const logout = document.querySelector("[data-logout]");
      return [
        ...pages,
        { label: "Use light theme", hint: "Appearance", run: () => XF.setTheme("light") },
        { label: "Use dark theme", hint: "Appearance", run: () => XF.setTheme("dark") },
        { label: "Match system theme", hint: "Appearance", run: () => XF.setTheme("system") },
        ...(password ? [{ label: password.textContent.trim(), hint: "Account", run: () => { window.location.href = password.href; } }] : []),
        ...(logout ? [{ label: "Log out", hint: "Account", run: () => logout.click() }] : [])
      ];
    };

    // Prefix matches rank first, then word starts, then anywhere, then letters in order ("tb" finds Trial Balance).
    const score = (label, term) => {
      const text = label.toLowerCase();
      if (text.startsWith(term)) return 4;
      if (text.split(/\s+/).some((word) => word.startsWith(term))) return 3;
      if (text.includes(term)) return 2;
      let matched = 0;
      for (const char of text) if (char === term[matched]) matched += 1;
      return matched === term.length ? 1 : 0;
    };

    const select = (index) => {
      if (!results.length) {
        input.removeAttribute("aria-activedescendant");
        return;
      }
      active = (index + results.length) % results.length;
      [...list.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    };

    const close = () => {
      overlay.hidden = true;
      returnFocus?.focus?.();
    };

    const choose = (index) => {
      const command = results[index];
      if (!command) return;
      close();
      command.run();
    };

    const render = () => {
      const term = input.value.trim().toLowerCase();
      results = term
        ? commands.map((command) => ({ command, rank: score(command.label, term) }))
          .filter((match) => match.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .map((match) => match.command)
        : commands;
      list.replaceChildren(...results.map((command, index) => {
        const item = document.createElement("li");
        item.id = `palette-option-${index}`;
        item.className = "palette-item";
        item.setAttribute("role", "option");
        const label = document.createElement("span");
        label.textContent = command.label;
        const hint = document.createElement("span");
        hint.textContent = command.hint;
        item.append(label, hint);
        item.addEventListener("mousemove", () => { if (active !== index) select(index); });
        item.addEventListener("click", () => choose(index));
        return item;
      }));
      empty.hidden = results.length > 0;
      select(0);
    };

    const create = () => {
      overlay = document.createElement("div");
      overlay.className = "palette-overlay";
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="palette" role="dialog" aria-modal="true" aria-label="Go to a page or action">
          <div class="palette-input">
            <svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
              placeholder="Search pages and actions" autocomplete="off" spellcheck="false">
            <kbd>Esc</kbd>
          </div>
          <ul class="palette-list" id="palette-list" role="listbox" aria-label="Results"></ul>
          <p class="palette-empty" hidden>Nothing matches your search</p>
          <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
        </div>`;
      document.body.appendChild(overlay);
      input = overlay.querySelector("input");
      list = overlay.querySelector(".palette-list");
      empty = overlay.querySelector(".palette-empty");
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
      input.addEventListener("input", render);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          select(active + (e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          choose(active);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "Tab") {
          e.preventDefault(); // focus stays in the palette while it is open
        }
      });
    };

    const open = () => {
      if (!overlay) create();
      commands = buildCommands();
      returnFocus = document.activeElement;
      overlay.hidden = false;
      input.value = "";
      render();
      input.focus();
    };

    document.addEventListener("keydown", (e) => {
      const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay && !overlay.hidden) close();
        else open();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    });
    document.querySelectorAll("[data-palette-open]").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        open();
      });
    });
  }

  window.XF = XF;
})();
