import { Op, QueryTypes, Transaction } from "sequelize";
import { sequelize, Account, Contact, Invoice, InvoiceLine, JournalEntry, Payment } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";
import { addDays, parseDate, today } from "./dateUtils.js";
import { postEntry, postReversal } from "./journalService.js";
import {
  formatEntryNumber,
  getAccountingSettings,
  getControlAccounts,
  getSalesPurchaseSettings
} from "./settingService.js";

// Everything that differs between a sales invoice (receivable) and a supplier bill (payable).
export const DOCUMENT_KINDS = {
  invoice: {
    label: "Sales invoice",
    plural: "Sales invoices",
    contactType: "customer",
    contactLabel: "Customer",
    entryType: "invoice",
    paymentEntryType: "receipt",
    lineAccountTypes: ["revenue"],
    prefixKey: "invoicePrefix",
    viewUrl: urls.invoiceView,
    gridUrl: urls.invoiceGrid
  },
  bill: {
    label: "Bill",
    plural: "Bills",
    contactType: "supplier",
    contactLabel: "Supplier",
    entryType: "bill",
    paymentEntryType: "disbursement",
    lineAccountTypes: ["expense", "asset"],
    prefixKey: "billPrefix",
    viewUrl: urls.billView,
    gridUrl: urls.billGrid
  }
};

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (value) => value / 100;

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

async function documentNumber(kind, id) {
  const settings = await getSalesPurchaseSettings();
  return formatEntryNumber(id, settings[DOCUMENT_KINDS[kind].prefixKey]);
}

// Accounts a document line may use: revenue for invoices, expense or non-cash asset for bills.
export async function lineAccountOptions(kind) {
  const rows = await Account.findAll({
    where: { type: { [Op.in]: DOCUMENT_KINDS[kind].lineAccountTypes }, status: 1, is_cash: false },
    order: [["code", "ASC"]],
    raw: true
  });
  return rows.map((a) => ({ uuid: a.uuid, code: a.code, name: a.name }));
}

export async function cashAccountOptions() {
  const rows = await Account.findAll({ where: { is_cash: true, status: 1 }, order: [["code", "ASC"]], raw: true });
  return rows.map((a) => ({ uuid: a.uuid, code: a.code, name: a.name }));
}

async function prepareLines(kind, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AccountingValidationError("Add at least one line");
  }
  const allowed = new Map((await lineAccountOptions(kind)).map((a) => [a.uuid, a]));
  const accountIds = new Map(
    (await Account.findAll({ where: { uuid: [...allowed.keys()] }, attributes: ["uuid", "accounting_account_id"], raw: true }))
      .map((a) => [a.uuid, a.accounting_account_id])
  );
  return lines.map((line, index) => {
    const n = index + 1;
    const account = allowed.get(line?.account);
    if (!account) {
      throw new AccountingValidationError(`Line ${n}: select an account`);
    }
    const quantity = Number(line.quantity);
    const unitPriceCents = cents(line.unit_price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AccountingValidationError(`Line ${n}: quantity must be greater than zero`);
    }
    if (!Number.isFinite(Number(line.unit_price)) || unitPriceCents < 0) {
      throw new AccountingValidationError(`Line ${n}: unit price must be zero or more`);
    }
    const amountCents = Math.round(quantity * unitPriceCents);
    if (amountCents <= 0) {
      throw new AccountingValidationError(`Line ${n}: amount must be greater than zero`);
    }
    return {
      accountId: accountIds.get(account.uuid),
      account,
      description: line.description ? String(line.description).trim().slice(0, 255) : null,
      quantity: Number(quantity.toFixed(4)),
      unitPriceCents,
      amountCents
    };
  });
}

export async function createDocument(kind, data, adminUserId) {
  const config = DOCUMENT_KINDS[kind];
  const settings = await getSalesPurchaseSettings();
  const contact =
    data?.contact && UUID_PATTERN.test(data.contact)
      ? await Contact.findOne({ where: { uuid: data.contact, type: config.contactType }, raw: true })
      : null;
  if (!contact || Number(contact.status) !== 1) {
    throw new AccountingValidationError(`Select an active ${config.contactLabel.toLowerCase()}`);
  }
  const issueDate = parseDate(String(data.issue_date ?? "").trim());
  if (!issueDate) {
    throw new AccountingValidationError("A valid date is required");
  }
  const dueDate = data.due_date ? parseDate(String(data.due_date).trim()) : addDays(issueDate, settings.paymentTermsDays);
  if (!dueDate || dueDate < issueDate) {
    throw new AccountingValidationError("The due date must be on or after the date");
  }
  const vatRate = [true, "1", 1, "true", "on"].includes(data.vat) ? settings.vatRate : 0;
  const lines = await prepareLines(kind, data.lines);
  const subtotal = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const vat = Math.round((subtotal * vatRate) / 100);
  const total = subtotal + vat;
  const controls = await getControlAccounts();
  const reference = data.reference ? String(data.reference).trim().slice(0, 255) || null : null;

  // Invoice: Dr receivable / Cr revenue lines and output VAT.
  // Bill: Dr expense lines and input VAT / Cr payable.
  const ledgerLines =
    kind === "invoice"
      ? [
          { accountId: controls.ar.accounting_account_id, debitCents: total, description: contact.name },
          ...lines.map((l) => ({ accountId: l.accountId, creditCents: l.amountCents, description: l.description })),
          { accountId: controls.outputVat.accounting_account_id, creditCents: vat, description: `Output VAT ${vatRate}%` }
        ]
      : [
          ...lines.map((l) => ({ accountId: l.accountId, debitCents: l.amountCents, description: l.description })),
          { accountId: controls.inputVat.accounting_account_id, debitCents: vat, description: `Input VAT ${vatRate}%` },
          { accountId: controls.ap.accounting_account_id, creditCents: total, description: contact.name }
        ];

  return sequelize.transaction(async (transaction) => {
    const entry = await postEntry(
      transaction,
      {
        entry_date: issueDate,
        reference,
        description: `${config.label} - ${contact.name}`,
        created_by: adminUserId ?? null,
        entry_type: config.entryType
      },
      ledgerLines
    );
    const document = await Invoice.create(
      {
        kind,
        contact_id: contact.contact_id,
        issue_date: issueDate,
        due_date: dueDate,
        reference,
        memo: data.memo ? String(data.memo).trim() || null : null,
        vat_rate: vatRate,
        subtotal: pesos(subtotal).toFixed(2),
        vat_amount: pesos(vat).toFixed(2),
        total: pesos(total).toFixed(2),
        journal_entry_id: entry.accounting_journal_entry_id,
        created_by: adminUserId ?? null
      },
      { transaction }
    );
    await InvoiceLine.bulkCreate(
      lines.map((l, index) => ({
        invoice_id: document.invoice_id,
        account_id: l.accountId,
        description: l.description,
        quantity: l.quantity,
        unit_price: pesos(l.unitPriceCents).toFixed(2),
        amount: pesos(l.amountCents).toFixed(2),
        sort_order: index
      })),
      { transaction }
    );
    // The entry is created first (the document needs its id); its reference becomes the document number.
    const number = await documentNumber(kind, document.invoice_id);
    await JournalEntry.update(
      { reference: reference ? `${number} / ${reference}` : number, description: `${config.label} ${number} - ${contact.name}` },
      { where: { accounting_journal_entry_id: entry.accounting_journal_entry_id }, transaction }
    );
    return { document: document.get({ plain: true }), number, contact, total: pesos(total) };
  });
}

async function findDocumentRow(uuid, transaction) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  return Invoice.findOne({
    where: { uuid },
    transaction,
    // Locked so two payments cannot both pass the "not more than the balance" check.
    lock: transaction ? Transaction.LOCK.UPDATE : undefined
  });
}

export async function recordPayment(documentUuid, data, adminUserId) {
  const paymentDate = parseDate(String(data?.payment_date ?? "").trim());
  if (!paymentDate) {
    throw new AccountingValidationError("A valid payment date is required");
  }
  const amount = cents(data.amount);
  if (!Number.isFinite(Number(data.amount)) || amount <= 0) {
    throw new AccountingValidationError("The payment amount must be greater than zero");
  }
  const cashAccount =
    data.cash_account && UUID_PATTERN.test(data.cash_account)
      ? await Account.findOne({ where: { uuid: data.cash_account, is_cash: true, status: 1 }, raw: true })
      : null;
  if (!cashAccount) {
    throw new AccountingValidationError("Select a cash or bank account");
  }
  const controls = await getControlAccounts();
  const reference = data.reference ? String(data.reference).trim().slice(0, 255) || null : null;

  return sequelize.transaction(async (transaction) => {
    const document = await findDocumentRow(documentUuid, transaction);
    if (!document) {
      throw new AccountingValidationError("Document not found");
    }
    const config = DOCUMENT_KINDS[document.kind];
    if (document.status !== "open") {
      throw new AccountingValidationError(`This ${config.label.toLowerCase()} is ${document.status}`);
    }
    if (paymentDate < document.issue_date) {
      throw new AccountingValidationError(`The payment date cannot be earlier than ${document.issue_date}`);
    }
    const balance = cents(document.total) - cents(document.amount_paid);
    if (amount > balance) {
      throw new AccountingValidationError(`The payment cannot exceed the balance of ${pesos(balance).toFixed(2)}`);
    }
    const contact = await Contact.findByPk(document.contact_id, { raw: true, transaction });
    const number = await documentNumber(document.kind, document.invoice_id);
    const lines =
      document.kind === "invoice"
        ? [
            { accountId: cashAccount.accounting_account_id, debitCents: amount, description: contact.name },
            { accountId: controls.ar.accounting_account_id, creditCents: amount, description: number }
          ]
        : [
            { accountId: controls.ap.accounting_account_id, debitCents: amount, description: number },
            { accountId: cashAccount.accounting_account_id, creditCents: amount, description: contact.name }
          ];
    const entry = await postEntry(
      transaction,
      {
        entry_date: paymentDate,
        reference: reference ? `${number} / ${reference}` : number,
        description: `${document.kind === "invoice" ? "Payment received for" : "Payment made for"} ${number} - ${contact.name}`,
        created_by: adminUserId ?? null,
        entry_type: config.paymentEntryType
      },
      lines
    );
    const payment = await Payment.create(
      {
        invoice_id: document.invoice_id,
        payment_date: paymentDate,
        amount: pesos(amount).toFixed(2),
        cash_account_id: cashAccount.accounting_account_id,
        reference,
        journal_entry_id: entry.accounting_journal_entry_id,
        created_by: adminUserId ?? null
      },
      { transaction }
    );
    const paid = cents(document.amount_paid) + amount;
    await document.update(
      { amount_paid: pesos(paid).toFixed(2), status: paid === cents(document.total) ? "paid" : "open" },
      { transaction }
    );
    return { payment: payment.get({ plain: true }), number, amount: pesos(amount), document: document.get({ plain: true }) };
  });
}

export async function voidPayment(paymentUuid, data, adminUserId) {
  const voidDate = parseDate(String(data?.void_date ?? "").trim()) ?? today();
  return sequelize.transaction(async (transaction) => {
    const payment =
      paymentUuid && UUID_PATTERN.test(paymentUuid)
        ? await Payment.findOne({ where: { uuid: paymentUuid }, transaction, lock: Transaction.LOCK.UPDATE })
        : null;
    if (!payment || payment.status !== "posted") {
      throw new AccountingValidationError("Payment not found or already void");
    }
    if (voidDate < payment.payment_date) {
      throw new AccountingValidationError(`The void date cannot be earlier than the payment date (${payment.payment_date})`);
    }
    const document = await Invoice.findByPk(payment.invoice_id, { transaction, lock: Transaction.LOCK.UPDATE });
    const number = await documentNumber(document.kind, document.invoice_id);
    const reversal = await postReversal(transaction, {
      originalId: payment.journal_entry_id,
      entryDate: voidDate,
      reference: number,
      description: `Void of payment for ${number}`,
      createdBy: adminUserId
    });
    await payment.update({ status: "void", void_entry_id: reversal.accounting_journal_entry_id }, { transaction });
    const paid = cents(document.amount_paid) - cents(payment.amount);
    await document.update({ amount_paid: pesos(paid).toFixed(2), status: "open" }, { transaction });
    return { number, amount: Number(payment.amount), document: document.get({ plain: true }) };
  });
}

export async function voidDocument(documentUuid, data, adminUserId) {
  const voidDate = parseDate(String(data?.void_date ?? "").trim()) ?? today();
  return sequelize.transaction(async (transaction) => {
    const document = await findDocumentRow(documentUuid, transaction);
    if (!document) {
      throw new AccountingValidationError("Document not found");
    }
    const config = DOCUMENT_KINDS[document.kind];
    if (document.status === "void") {
      throw new AccountingValidationError(`This ${config.label.toLowerCase()} is already void`);
    }
    if (await Payment.count({ where: { invoice_id: document.invoice_id, status: "posted" }, transaction })) {
      throw new AccountingValidationError("Void its payments first");
    }
    if (voidDate < document.issue_date) {
      throw new AccountingValidationError(`The void date cannot be earlier than ${document.issue_date}`);
    }
    const number = await documentNumber(document.kind, document.invoice_id);
    const reason = String(data?.reason ?? "").trim();
    const reversal = await postReversal(transaction, {
      originalId: document.journal_entry_id,
      entryDate: voidDate,
      reference: number,
      description: `Void of ${config.label.toLowerCase()} ${number}${reason ? ` (${reason})` : ""}`,
      createdBy: adminUserId
    });
    await document.update(
      { status: "void", void_entry_id: reversal.accounting_journal_entry_id, voided_on: voidDate },
      { transaction }
    );
    return { number, document: document.get({ plain: true }), config };
  });
}

const DOCUMENT_SQL = `
  SELECT i.*, c.name AS contact_name, c.uuid AS contact_uuid, c.tin AS contact_tin, c.address AS contact_address,
    c.email AS contact_email, e.uuid AS entry_uuid, v.uuid AS void_entry_uuid,
    DATE_FORMAT(i.issue_date, '%Y-%m-%d') AS issue_date_s, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date_s
  FROM invoice i
  INNER JOIN contact c ON c.contact_id = i.contact_id
  INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = i.journal_entry_id
  LEFT JOIN accounting_journal_entry v ON v.accounting_journal_entry_id = i.void_entry_id
`;

function toDocument(row, settings, entryPrefix, asOf = today()) {
  const config = DOCUMENT_KINDS[row.kind];
  const balance = cents(row.total) - cents(row.amount_paid);
  const overdue = row.status === "open" && row.due_date_s < asOf;
  return {
    invoiceId: row.invoice_id,
    uuid: row.uuid,
    kind: row.kind,
    kindLabel: config.label,
    number: formatEntryNumber(row.invoice_id, settings[config.prefixKey]),
    contact: { name: row.contact_name, uuid: row.contact_uuid, tin: row.contact_tin, address: row.contact_address, email: row.contact_email },
    issueDate: row.issue_date_s,
    dueDate: row.due_date_s,
    reference: row.reference,
    memo: row.memo,
    vatRate: Number(row.vat_rate),
    subtotal: Number(row.subtotal),
    vatAmount: Number(row.vat_amount),
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    balance: pesos(balance),
    status: row.status,
    statusLabel: overdue ? "Overdue" : { open: "Open", paid: "Paid", void: "Void" }[row.status],
    overdue,
    daysOverdue: overdue ? daysBetween(row.due_date_s, asOf) : 0,
    voidedOn: row.voided_on,
    viewUrl: config.viewUrl(row.uuid),
    entry: { number: formatEntryNumber(row.journal_entry_id, entryPrefix), url: urls.accountingJournalView(row.entry_uuid) },
    voidEntry: row.void_entry_id
      ? { number: formatEntryNumber(row.void_entry_id, entryPrefix), url: urls.accountingJournalView(row.void_entry_uuid) }
      : null,
    paymentApi: urls.recordPayment(row.uuid),
    voidApi: urls.voidDocument(row.uuid)
  };
}

export async function getDocument(kind, uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const [row] = await sequelize.query(`${DOCUMENT_SQL} WHERE i.uuid = ? AND i.kind = ?`, {
    replacements: [uuid, kind],
    type: QueryTypes.SELECT
  });
  if (!row) return null;
  const settings = await getSalesPurchaseSettings();
  const { entryPrefix } = await getAccountingSettings();
  const document = toDocument(row, settings, entryPrefix);
  document.lines = (
    await sequelize.query(
      `SELECT l.*, a.code, a.name FROM invoice_line l
       INNER JOIN accounting_account a ON a.accounting_account_id = l.account_id
       WHERE l.invoice_id = ? ORDER BY l.sort_order, l.invoice_line_id`,
      { replacements: [row.invoice_id], type: QueryTypes.SELECT }
    )
  ).map((l) => ({
    account: `${l.code} - ${l.name}`,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    amount: Number(l.amount)
  }));
  document.payments = (
    await sequelize.query(
      `SELECT p.*, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date_s, a.code, a.name,
         e.uuid AS entry_uuid, v.uuid AS void_entry_uuid
       FROM payment p
       INNER JOIN accounting_account a ON a.accounting_account_id = p.cash_account_id
       INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = p.journal_entry_id
       LEFT JOIN accounting_journal_entry v ON v.accounting_journal_entry_id = p.void_entry_id
       WHERE p.invoice_id = ? ORDER BY p.payment_date, p.payment_id`,
      { replacements: [row.invoice_id], type: QueryTypes.SELECT }
    )
  ).map((p) => ({
    uuid: p.uuid,
    date: p.payment_date_s,
    amount: Number(p.amount),
    account: `${p.code} - ${p.name}`,
    reference: p.reference,
    status: p.status,
    isVoid: p.status === "void",
    entry: { number: formatEntryNumber(p.journal_entry_id, entryPrefix), url: urls.accountingJournalView(p.entry_uuid) },
    voidEntry: p.void_entry_id
      ? { number: formatEntryNumber(p.void_entry_id, entryPrefix), url: urls.accountingJournalView(p.void_entry_uuid) }
      : null,
    voidApi: urls.voidPayment(p.uuid)
  }));
  document.hasPostedPayments = document.payments.some((p) => !p.isVoid);
  return document;
}

export async function listDocuments(kind, { page = 1, limit = 20, status = "", keyword = "" } = {}) {
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(Math.max(1, limit || 20), 200);
  const conditions = ["i.kind = :kind"];
  const replacements = { kind, today: today() };
  if (status === "overdue") conditions.push("i.status = 'open' AND i.due_date < :today");
  else if (["open", "paid", "void"].includes(status)) {
    conditions.push("i.status = :status");
    replacements.status = status;
  }
  if (keyword && keyword.trim()) {
    replacements.like = `%${keyword.trim()}%`;
    const digits = keyword.replace(/\D/g, "");
    replacements.id = digits ? Number(digits) : -1;
    conditions.push("(c.name LIKE :like OR i.reference LIKE :like OR i.invoice_id = :id)");
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const [{ total }] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM invoice i INNER JOIN contact c ON c.contact_id = i.contact_id ${where}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const rows = await sequelize.query(
    `${DOCUMENT_SQL} ${where} ORDER BY i.issue_date DESC, i.invoice_id DESC
     LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const settings = await getSalesPurchaseSettings();
  const { entryPrefix } = await getAccountingSettings();
  return {
    items: rows.map((r) => toDocument(r, settings, entryPrefix)),
    total: Number(total),
    page: safePage,
    limit: safeLimit,
    keyword: keyword ?? "",
    status
  };
}

export async function listContactDocuments(contactId) {
  const rows = await sequelize.query(`${DOCUMENT_SQL} WHERE i.contact_id = ? ORDER BY i.issue_date DESC, i.invoice_id DESC`, {
    replacements: [contactId],
    type: QueryTypes.SELECT
  });
  const settings = await getSalesPurchaseSettings();
  const { entryPrefix } = await getAccountingSettings();
  return rows.map((r) => toDocument(r, settings, entryPrefix));
}

export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "over90", label: "Over 90 days" }
];

function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "over90";
}

// Unpaid balances as of a date, grouped by contact and by days past due.
export async function getAging(kind, asOf) {
  const rows = await sequelize.query(
    `SELECT i.invoice_id, i.uuid, i.total, c.name AS contact_name, c.uuid AS contact_uuid,
       DATE_FORMAT(i.issue_date, '%Y-%m-%d') AS issue_date_s, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date_s,
       COALESCE((SELECT SUM(p.amount) FROM payment p
         WHERE p.invoice_id = i.invoice_id AND p.status = 'posted' AND p.payment_date <= :asOf), 0) AS paid
     FROM invoice i
     INNER JOIN contact c ON c.contact_id = i.contact_id
     WHERE i.kind = :kind AND i.issue_date <= :asOf
       AND (i.status <> 'void' OR i.voided_on > :asOf)
     ORDER BY c.name, i.due_date`,
    { replacements: { kind, asOf }, type: QueryTypes.SELECT }
  );
  const settings = await getSalesPurchaseSettings();
  const config = DOCUMENT_KINDS[kind];
  const empty = () => Object.fromEntries([...AGING_BUCKETS.map((b) => [b.key, 0]), ["total", 0]]);
  const byContact = new Map();
  const totals = empty();
  const documents = [];
  for (const row of rows) {
    const balance = cents(row.total) - cents(row.paid);
    if (balance <= 0) continue;
    const daysPastDue = daysBetween(row.due_date_s, asOf);
    const bucket = bucketFor(daysPastDue);
    if (!byContact.has(row.contact_uuid)) byContact.set(row.contact_uuid, { name: row.contact_name, amounts: empty() });
    const group = byContact.get(row.contact_uuid).amounts;
    group[bucket] += balance;
    group.total += balance;
    totals[bucket] += balance;
    totals.total += balance;
    documents.push({
      number: formatEntryNumber(row.invoice_id, settings[config.prefixKey]),
      url: config.viewUrl(row.uuid),
      contact: row.contact_name,
      issueDate: row.issue_date_s,
      dueDate: row.due_date_s,
      daysPastDue: Math.max(0, daysPastDue),
      balance: pesos(balance)
    });
  }
  const toCells = (amounts) => ({
    buckets: AGING_BUCKETS.map((b) => pesos(amounts[b.key])),
    total: pesos(amounts.total)
  });
  return {
    contacts: [...byContact.values()].map((c) => ({ name: c.name, ...toCells(c.amounts) })),
    totals: toCells(totals),
    documents
  };
}

// BIR-style sales or purchase book: every document issued in the period (void ones flagged).
export async function getDocumentBook(kind, { from, to }) {
  const rows = await sequelize.query(
    `${DOCUMENT_SQL} WHERE i.kind = ? AND i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date, i.invoice_id`,
    { replacements: [kind, from, to], type: QueryTypes.SELECT }
  );
  const settings = await getSalesPurchaseSettings();
  const { entryPrefix } = await getAccountingSettings();
  const documents = rows.map((r) => toDocument(r, settings, entryPrefix));
  const sum = (key) => pesos(documents.filter((d) => d.status !== "void").reduce((s, d) => s + cents(d[key]), 0));
  return {
    documents,
    totals: {
      subtotal: sum("subtotal"),
      vatAmount: sum("vatAmount"),
      total: sum("total"),
      vatable: pesos(documents.filter((d) => d.status !== "void" && d.vatRate > 0).reduce((s, d) => s + cents(d.subtotal), 0)),
      nonVat: pesos(documents.filter((d) => d.status !== "void" && d.vatRate === 0).reduce((s, d) => s + cents(d.subtotal), 0))
    }
  };
}

// Open receivables or payables, for the dashboard.
export async function getOpenSummary(kind) {
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(total - amount_paid), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN due_date < :today THEN total - amount_paid ELSE 0 END), 0) AS overdue,
       COUNT(*) AS open_count
     FROM invoice WHERE kind = :kind AND status = 'open'`,
    { replacements: { kind, today: today() }, type: QueryTypes.SELECT }
  );
  return { outstanding: Number(row.outstanding), overdue: Number(row.overdue), openCount: Number(row.open_count) };
}

export async function listOverdue(kind, limit = 5) {
  const rows = await sequelize.query(
    `${DOCUMENT_SQL} WHERE i.kind = ? AND i.status = 'open' AND i.due_date < ? ORDER BY i.due_date LIMIT ${Number(limit)}`,
    { replacements: [kind, today()], type: QueryTypes.SELECT }
  );
  const settings = await getSalesPurchaseSettings();
  const { entryPrefix } = await getAccountingSettings();
  return rows.map((r) => toDocument(r, settings, entryPrefix));
}
