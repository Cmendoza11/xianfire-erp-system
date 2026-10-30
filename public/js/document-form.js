(function () {
  const data = JSON.parse(document.getElementById("doc-page-data").textContent);
  const formatter = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (cents) => formatter.format(cents / 100);
  const $ = (selector) => document.querySelector(selector);

  const contact = $("[data-doc-contact]");
  const issueDate = $("[data-doc-issue-date]");
  const dueDate = $("[data-doc-due-date]");
  const vat = $("[data-doc-vat]");
  const linesBody = $("[data-doc-lines]");
  const template = document.getElementById("doc-line-template");
  const saveButton = $("[data-doc-save]");

  data.contacts.forEach((c) => contact.add(new Option(c.name, c.uuid)));
  $("[data-vat-rate]").textContent = data.vatRate;
  issueDate.value = data.issueDate;
  dueDate.value = data.dueDate;

  // Moving the date moves the due date by the default payment terms.
  issueDate.addEventListener("change", () => {
    if (!issueDate.value) return;
    const due = new Date(`${issueDate.value}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + data.paymentTermsDays);
    dueDate.value = due.toISOString().slice(0, 10);
  });

  // Mirrors the server: amount = round(quantity x unit price in cents); VAT on the subtotal.
  const lineCents = (row) => {
    const qty = Number(row.querySelector("[data-line-quantity]").value);
    const price = Math.round(Number(row.querySelector("[data-line-price]").value) * 100);
    return Number.isFinite(qty) && Number.isFinite(price) && qty > 0 && price > 0 ? Math.round(qty * price) : 0;
  };

  function refresh() {
    const rows = [...linesBody.querySelectorAll("[data-doc-line]")];
    let subtotal = 0;
    rows.forEach((row) => {
      const amount = lineCents(row);
      subtotal += amount;
      row.querySelector("[data-line-amount]").textContent = money(amount);
      row.querySelector("[data-line-remove]").disabled = rows.length <= 1;
    });
    const vatCents = vat.checked ? Math.round((subtotal * data.vatRate) / 100) : 0;
    $("[data-doc-subtotal]").textContent = money(subtotal);
    $("[data-doc-vat-amount]").textContent = money(vatCents);
    $("[data-doc-total]").textContent = money(subtotal + vatCents);
  }

  function addLine() {
    const row = template.content.firstElementChild.cloneNode(true);
    const select = row.querySelector("[data-line-account]");
    data.accounts.forEach((a) => select.add(new Option(`${a.code} - ${a.name}`, a.uuid)));
    row.addEventListener("input", refresh);
    row.querySelector("[data-line-remove]").addEventListener("click", () => {
      row.remove();
      refresh();
    });
    linesBody.appendChild(row);
    refresh();
  }

  $("[data-doc-add-line]").addEventListener("click", addLine);
  vat.addEventListener("change", refresh);

  saveButton.addEventListener("click", async () => {
    if (!contact.value) {
      XF.toast("error", "Select a contact");
      return;
    }
    XF.setLoading(saveButton, true);
    const result = await XF.api("POST", data.action, {
      contact: contact.value,
      issue_date: issueDate.value,
      due_date: dueDate.value,
      reference: $("[data-doc-reference]").value.trim() || null,
      memo: $("[data-doc-memo]").value.trim() || null,
      vat: vat.checked,
      lines: [...linesBody.querySelectorAll("[data-doc-line]")].map((row) => ({
        account: row.querySelector("[data-line-account]").value,
        description: row.querySelector("[data-line-description]").value.trim() || null,
        quantity: row.querySelector("[data-line-quantity]").value,
        unit_price: row.querySelector("[data-line-price]").value
      }))
    });
    if (result.ok) {
      XF.toast("success", `${result.body.data.number} posted`);
      setTimeout(() => {
        window.location.href = result.body.data.viewUrl;
      }, 800);
    } else {
      XF.toast("error", XF.errorMessage(result));
      XF.setLoading(saveButton, false);
    }
  });

  addLine();
})();
