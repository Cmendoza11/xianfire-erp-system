(function () {
  const { action, gridUrl, accounts, lockDate } = JSON.parse(
    document.getElementById("journal-page-data").textContent
  );
  const MIN_LINES = 2;
  const formatter = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatMoney = (value) => formatter.format(Number(value ?? 0));

  const linesBody = document.querySelector("[data-lines]");
  const template = document.getElementById("journal-line-template");
  const entryDate = document.querySelector("[data-entry-date]");
  const reference = document.querySelector("[data-entry-reference]");
  const description = document.querySelector("[data-entry-description]");
  const totalDebitEl = document.querySelector("[data-total-debit]");
  const totalCreditEl = document.querySelector("[data-total-credit]");
  const status = document.querySelector("[data-balance-status]");
  const postButton = document.querySelector("[data-post-entry]");

  function toCents(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }

  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const lineRows = () => [...linesBody.querySelectorAll("[data-line]")];

  function readLine(row) {
    return {
      account: row.querySelector("[data-line-account]").value,
      description: row.querySelector("[data-line-description]").value,
      debit: row.querySelector("[data-line-debit]").value,
      credit: row.querySelector("[data-line-credit]").value
    };
  }

  function totals() {
    const lines = lineRows().map(readLine);
    const totalDebit = lines.reduce((sum, l) => sum + toCents(l.debit), 0);
    const totalCredit = lines.reduce((sum, l) => sum + toCents(l.credit), 0);
    return { totalDebit, totalCredit, balanced: totalDebit > 0 && totalDebit === totalCredit };
  }

  function refresh() {
    const { totalDebit, totalCredit, balanced } = totals();
    totalDebitEl.textContent = formatMoney(totalDebit / 100);
    totalCreditEl.textContent = formatMoney(totalCredit / 100);
    status.textContent = balanced
      ? "Balanced"
      : `Out of balance by ${formatMoney(Math.abs(totalDebit - totalCredit) / 100)}`;
    status.className = `mt-3 text-sm font-medium ${balanced ? "text-green-700" : "text-destructive"}`;
    postButton.disabled = !balanced;
    const rows = lineRows();
    rows.forEach((row) => {
      row.querySelector("[data-remove-line]").disabled = rows.length <= MIN_LINES;
    });
  }

  function addLine() {
    const row = template.content.firstElementChild.cloneNode(true);
    const select = row.querySelector("[data-line-account]");
    accounts.forEach((a) => {
      const option = document.createElement("option");
      option.value = a.uuid;
      option.textContent = `${a.code} - ${a.name} (${a.typeLabel})`;
      select.appendChild(option);
    });
    const debit = row.querySelector("[data-line-debit]");
    const credit = row.querySelector("[data-line-credit]");
    // A line is either a debit or a credit: typing in one side clears the other.
    debit.addEventListener("input", () => {
      if (debit.value) credit.value = "";
      refresh();
    });
    credit.addEventListener("input", () => {
      if (credit.value) debit.value = "";
      refresh();
    });
    row.querySelector("[data-remove-line]").addEventListener("click", (e) => {
      e.preventDefault();
      if (lineRows().length <= MIN_LINES) return;
      row.remove();
      refresh();
    });
    linesBody.appendChild(row);
    refresh();
  }

  async function submit() {
    if (!description.value.trim()) {
      XF.toast("error", "Description is required");
      return;
    }
    if (!totals().balanced) {
      XF.toast("error", "Total debit must equal total credit");
      return;
    }
    XF.setLoading(postButton, true);
    const result = await XF.api("POST", action, {
      entry_date: entryDate.value,
      reference: reference.value.trim() || null,
      description: description.value.trim(),
      lines: lineRows()
        .map(readLine)
        .filter((l) => l.account || l.debit || l.credit)
        .map((l) => ({
          account: l.account,
          description: l.description.trim() || null,
          debit: l.debit || 0,
          credit: l.credit || 0
        }))
    });
    if (result.ok) {
      XF.toast("success", "Journal entry posted!");
      const view = result.body?.data?.links?.find((link) => link.rel === "view");
      setTimeout(() => {
        window.location.href = view?.href || gridUrl;
      }, 800);
    } else {
      XF.toast("error", XF.errorMessage(result));
      XF.setLoading(postButton, false);
      refresh();
    }
  }

  entryDate.value = today();
  if (lockDate) {
    // The picker blocks closed dates; the server enforces the same rule.
    const firstOpen = new Date(`${lockDate}T00:00:00Z`);
    firstOpen.setUTCDate(firstOpen.getUTCDate() + 1);
    entryDate.min = firstOpen.toISOString().slice(0, 10);
  }
  document.querySelector("[data-add-line]").addEventListener("click", (e) => {
    e.preventDefault();
    addLine();
  });
  postButton.addEventListener("click", submit);
  for (let i = 0; i < MIN_LINES; i++) addLine();
})();
