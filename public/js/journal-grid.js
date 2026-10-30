// Grid search (Enter) and pagination; shared by the journal entry grid and the audit log.
(function () {
  const go = (mutate) => {
    const url = new URL(window.location.href);
    mutate(url.searchParams);
    window.location.href = url.href;
  };

  document.querySelector("[data-journal-search]")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const value = e.target.value.trim();
    go((params) => {
      if (value) params.set("keyword", value);
      else params.delete("keyword");
      params.delete("page");
    });
  });

  document.querySelector("[data-page-limit]")?.addEventListener("change", (e) => {
    go((params) => {
      params.set("limit", e.target.value || "10");
      params.delete("page");
    });
  });

  document.querySelectorAll("[data-page]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      go((params) => (page === "1" ? params.delete("page") : params.set("page", page)));
    });
  });
})();
