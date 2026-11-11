// /api/v1: the versioned API the other ERP systems (inventory, payroll, POS, ...) call with an API
// key. Handlers reuse the same services as the admin pages, so every ledger rule (balanced entries,
// closed periods, inactive accounts, payment limits) applies to integrations too.
import { positiveInt } from "../helpers/pagination.js";
import { hasScope } from "../middleware/apiKey.js";
import { Account, Invoice, Payment } from "../models/index.js";
import { getAccount, listAccounts, UUID_PATTERN } from "../services/accountService.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { diffFields, logAudit } from "../services/auditService.js";
import {
  CONTACT_TYPES,
  createContact as createContactRecord,
  getContact,
  listContacts,
  updateContact as updateContactRecord
} from "../services/contactService.js";
import { parseDate, today } from "../services/dateUtils.js";
import {
  createDocument,
  DOCUMENT_KINDS,
  getAging,
  getDocument,
  listDocuments,
  recordPayment as recordPaymentRecord,
  voidDocument as voidDocumentRecord,
  voidPayment as voidPaymentRecord
} from "../services/invoiceService.js";
import {
  CHANGE_CATEGORIES,
  createOnce,
  DOCUMENT_WRITE_SCOPE,
  externalIdsFor,
  IntegrationConflictError,
  linkExternalId,
  listChanges as listChangeRecords,
  normalizeExternalId,
  resolveAccountUuids,
  resolveUuid
} from "../services/integrationService.js";
import {
  createJournalEntry,
  getJournalEntry,
  listJournalEntries,
  reverseJournalEntry
} from "../services/journalService.js";
import { getBalanceSheet, getIncomeStatement, getTrialBalance, resolvePeriod } from "../services/reportService.js";
import { formatEntryNumber, getAccountingSettings } from "../services/settingService.js";

const API_VERSION = "1";

const apiError = (res, status, message) => res.status(status).json({ error: { status, message } });
const notFound = (res, what) => apiError(res, 404, `${what} not found`);

function sendError(res, e) {
  if (e instanceof AccountingValidationError) return apiError(res, 400, e.message);
  if (e instanceof IntegrationConflictError) return apiError(res, 409, e.message);
  throw e;
}

// The services return view models; links to admin pages and internal numeric ids are not part of
// the API contract, so they are removed (uuids are the stable public ids).
const PRIVATE_KEY = /(Url|Api)$|^url$|[a-z]Id$/;
function toPublic(value) {
  if (Array.isArray(value)) return value.map(toPublic);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_KEY.test(key))
      .map(([key, v]) => [key, toPublic(v)])
  );
}

async function withExternalIds(req, entityTypes, items) {
  const ids = await externalIdsFor(req.apiClient, entityTypes, items.map((i) => i.uuid));
  return items.map((item) => ({ ...toPublic(item), externalId: ids.get(item.uuid) ?? null }));
}

async function withExternalId(req, entityTypes, item) {
  return (await withExternalIds(req, entityTypes, [item]))[0];
}

const created = (res, data, duplicate) =>
  res.status(duplicate ? 200 : 201).json({ data, meta: { duplicate } });

const listMeta = ({ total, page, limit }) => ({ total, page, limit });
const pageQuery = (req) => ({
  page: positiveInt(req.query.page, 1),
  limit: positiveInt(req.query.limit, 20),
  keyword: typeof req.query.keyword === "string" ? req.query.keyword : ""
});

// Lines may name the account by code ("1010") or uuid; codes are resolved before validation.
async function resolveLineAccounts(lines) {
  if (!Array.isArray(lines)) return lines;
  const values = lines.map((l) => l?.account ?? l?.account_code);
  const resolve = await resolveAccountUuids(values);
  return lines.map((line, index) => {
    const value = values[index];
    const account = resolve(value);
    if (value && !account) {
      throw new AccountingValidationError(`Line ${index + 1}: no account with code or id "${value}"`);
    }
    return { ...line, account };
  });
}

async function resolveCashAccount(value) {
  if (!value) return null;
  const uuid = (await resolveAccountUuids([value]))(value);
  if (!uuid) throw new AccountingValidationError(`No account with code or id "${value}"`);
  return uuid;
}

// --- Info -----------------------------------------------------------------------------------

export const apiInfo = async (req, res) => {
  const settings = await getAccountingSettings();
  res.json({
    data: {
      apiVersion: API_VERSION,
      system: "accounting",
      client: { name: req.apiClient.name, systemCode: req.apiClient.systemCode, scopes: req.apiClient.scopes },
      company: { name: settings.companyName, tin: settings.companyTin, currency: settings.currency },
      serverDate: today()
    }
  });
};

// --- Chart of accounts ----------------------------------------------------------------------

export const listAccountsApi = async (req, res) => {
  const includeInactive = req.query.include_inactive === "1";
  const accounts = await listAccounts({ includeInactive });
  res.json({ data: toPublic(accounts) });
};

export const getAccountApi = async (req, res) => {
  const id = String(req.params.id);
  const uuid = UUID_PATTERN.test(id)
    ? id
    : (await Account.findOne({ where: { code: id }, attributes: ["uuid"], raw: true }))?.uuid;
  const account = uuid ? await getAccount(uuid) : null;
  if (!account) return notFound(res, "Account");
  res.json({ data: toPublic(account) });
};

// --- Customers and suppliers ----------------------------------------------------------------

export const listContactsApi = async (req, res) => {
  const type = req.query.type;
  if (type !== undefined && !CONTACT_TYPES[type]) {
    return apiError(res, 400, "type must be customer or supplier");
  }
  const includeInactive = req.query.include_inactive === "1";
  const types = type ? [type] : Object.keys(CONTACT_TYPES);
  const contacts = (await Promise.all(types.map((t) => listContacts(t, { includeInactive })))).flat();
  res.json({ data: await withExternalIds(req, "contact", contacts) });
};

export const getContactApi = async (req, res) => {
  const uuid = await resolveUuid(req.apiClient, "contact", req.params.id);
  const contact = uuid ? await getContact(uuid) : null;
  if (!contact) return notFound(res, "Contact");
  res.json({ data: await withExternalId(req, "contact", contact) });
};

export const createContactApi = async (req, res) => {
  try {
    const externalId = normalizeExternalId(req.body.external_id);
    const type = req.body.type;
    const { duplicate, uuid } = await createOnce(req.apiClient, "contact", externalId, async () => {
      const contact = await createContactRecord(type, req.body);
      await logAudit(req, {
        action: "contact.create",
        entityType: "contact",
        entityId: contact.uuid,
        summary: `Created ${type} ${contact.name} from ${req.apiClient.name}`,
        details: externalId ? { externalId } : null
      });
      return contact;
    });
    created(res, await withExternalId(req, "contact", await getContact(uuid)), duplicate);
  } catch (e) {
    sendError(res, e);
  }
};

export const updateContactApi = async (req, res) => {
  try {
    const uuid = await resolveUuid(req.apiClient, "contact", req.params.id);
    if (!uuid || !(await getContact(uuid))) return notFound(res, "Contact");
    // Lets a system attach its own id to a contact that was entered by hand in the admin. Checked
    // before the update so a rejected id leaves the contact unchanged.
    const externalId = normalizeExternalId(req.body.external_id);
    const currentExternalId = (await externalIdsFor(req.apiClient, "contact", [uuid])).get(uuid);
    if (externalId && currentExternalId && currentExternalId !== externalId) {
      return apiError(res, 409, `This contact is already linked to external_id "${currentExternalId}"`);
    }
    if (externalId && !currentExternalId) await linkExternalId(req.apiClient, "contact", externalId, uuid);
    const { before, after } = await updateContactRecord(uuid, req.body);
    const changes = diffFields(before, after, ["name", "email", "phone", "address", "tin", "status"]);
    if (Object.keys(changes).length > 0) {
      await logAudit(req, {
        action: "contact.update",
        entityType: "contact",
        entityId: after.uuid,
        summary: `Updated ${after.type} ${after.name} from ${req.apiClient.name}: ${Object.keys(changes).join(", ")}`,
        details: changes
      });
    }
    res.json({ data: await withExternalId(req, "contact", await getContact(uuid)) });
  } catch (e) {
    sendError(res, e);
  }
};

// --- Journal entries ------------------------------------------------------------------------

export const listJournalEntriesApi = async (req, res) => {
  const entries = await listJournalEntries(pageQuery(req));
  res.json({ data: await withExternalIds(req, "journal_entry", entries.items), meta: listMeta(entries) });
};

export const getJournalEntryApi = async (req, res) => {
  const uuid = await resolveUuid(req.apiClient, "journal_entry", req.params.id);
  const entry = uuid ? await getJournalEntry(uuid) : null;
  if (!entry) return notFound(res, "Journal entry");
  res.json({ data: await withExternalId(req, "journal_entry", entry) });
};

export const createJournalEntryApi = async (req, res) => {
  try {
    const externalId = normalizeExternalId(req.body.external_id);
    const body = { ...req.body, lines: await resolveLineAccounts(req.body.lines) };
    const { duplicate, uuid } = await createOnce(req.apiClient, "journal_entry", externalId, async () => {
      const entry = await createJournalEntry(body, null);
      const { entryPrefix } = await getAccountingSettings();
      const number = formatEntryNumber(entry.accounting_journal_entry_id, entryPrefix);
      const total = body.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
      await logAudit(req, {
        action: "journal.post",
        entityType: "journal_entry",
        entityId: entry.uuid,
        summary: `Posted ${number} (${entry.entry_date}) "${entry.description}" for ${total.toFixed(2)} from ${req.apiClient.name}`,
        details: { entryDate: entry.entry_date, reference: entry.reference, lines: body.lines.length, externalId }
      });
      return entry;
    });
    created(res, await withExternalId(req, "journal_entry", await getJournalEntry(uuid)), duplicate);
  } catch (e) {
    sendError(res, e);
  }
};

export const reverseJournalEntryApi = async (req, res) => {
  try {
    const uuid = await resolveUuid(req.apiClient, "journal_entry", req.params.id);
    if (!uuid) return notFound(res, "Journal entry");
    const { entry, original } = await reverseJournalEntry(uuid, req.body, null);
    const { entryPrefix } = await getAccountingSettings();
    const number = formatEntryNumber(entry.accounting_journal_entry_id, entryPrefix);
    await logAudit(req, {
      action: "journal.reverse",
      entityType: "journal_entry",
      entityId: original.uuid,
      summary: `Reversed ${original.entryNumber} with ${number} dated ${entry.entry_date} from ${req.apiClient.name}`,
      details: { reversalUuid: entry.uuid, reason: req.body?.reason || null }
    });
    res.status(201).json({ data: toPublic(await getJournalEntry(entry.uuid)) });
  } catch (e) {
    sendError(res, e);
  }
};

// --- Sales invoices and supplier bills ------------------------------------------------------

async function findDocumentUuid(req, kind) {
  const uuid = await resolveUuid(req.apiClient, kind, req.params.id);
  return uuid && (await getDocument(kind, uuid)) ? uuid : null;
}

export const listDocumentsApi = (kind) => async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const documents = await listDocuments(kind, { ...pageQuery(req), status });
  res.json({ data: await withExternalIds(req, kind, documents.items), meta: listMeta(documents) });
};

export const getDocumentApi = (kind) => async (req, res) => {
  const uuid = await findDocumentUuid(req, kind);
  if (!uuid) return notFound(res, DOCUMENT_KINDS[kind].label);
  res.json({ data: await withExternalId(req, kind, await getDocument(kind, uuid)) });
};

export const createDocumentApi = (kind) => async (req, res) => {
  try {
    const config = DOCUMENT_KINDS[kind];
    const externalId = normalizeExternalId(req.body.external_id);
    // The customer or supplier may be given by uuid or by this system's own id for it.
    const contact = req.body.contact ? await resolveUuid(req.apiClient, "contact", req.body.contact) : null;
    if (req.body.contact && !contact) {
      throw new AccountingValidationError(`No ${config.contactLabel.toLowerCase()} with id "${req.body.contact}"`);
    }
    const body = { ...req.body, contact, lines: await resolveLineAccounts(req.body.lines) };
    const { duplicate, uuid } = await createOnce(req.apiClient, kind, externalId, async () => {
      const result = await createDocument(kind, body, null);
      await logAudit(req, {
        action: "document.create",
        entityType: kind,
        entityId: result.document.uuid,
        summary: `Issued ${config.label.toLowerCase()} ${result.number} to ${result.contact.name} for ${result.total.toFixed(2)} (${result.document.issue_date}) from ${req.apiClient.name}`,
        details: externalId ? { externalId } : null
      });
      return result.document;
    });
    created(res, await withExternalId(req, kind, await getDocument(kind, uuid)), duplicate);
  } catch (e) {
    sendError(res, e);
  }
};

export const recordPaymentApi = (kind) => async (req, res) => {
  try {
    const documentUuid = await findDocumentUuid(req, kind);
    if (!documentUuid) return notFound(res, DOCUMENT_KINDS[kind].label);
    const externalId = normalizeExternalId(req.body.external_id);
    const body = { ...req.body, cash_account: await resolveCashAccount(req.body.cash_account) };
    const { duplicate, uuid } = await createOnce(req.apiClient, "payment", externalId, async () => {
      const { payment, number, amount } = await recordPaymentRecord(documentUuid, body, null);
      await logAudit(req, {
        action: "payment.record",
        entityType: "payment",
        entityId: payment.uuid,
        summary: `${kind === "invoice" ? "Received" : "Paid"} ${amount.toFixed(2)} for ${number} on ${payment.payment_date} from ${req.apiClient.name}`,
        details: externalId ? { externalId } : null
      });
      return payment;
    });
    const document = await getDocument(kind, documentUuid);
    const payment = document.payments.find((p) => p.uuid === uuid);
    if (!payment) {
      return apiError(res, 409, `external_id "${externalId}" was already used for a payment on another document`);
    }
    const paymentIds = await externalIdsFor(req.apiClient, "payment", [uuid]);
    created(
      res,
      {
        payment: { ...toPublic(payment), externalId: paymentIds.get(uuid) ?? null },
        document: await withExternalId(req, kind, document)
      },
      duplicate
    );
  } catch (e) {
    sendError(res, e);
  }
};

export const voidDocumentApi = (kind) => async (req, res) => {
  try {
    const uuid = await findDocumentUuid(req, kind);
    if (!uuid) return notFound(res, DOCUMENT_KINDS[kind].label);
    const { number, document, config } = await voidDocumentRecord(uuid, req.body, null);
    await logAudit(req, {
      action: "document.void",
      entityType: document.kind,
      entityId: document.uuid,
      summary: `Voided ${config.label.toLowerCase()} ${number} on ${document.voided_on} from ${req.apiClient.name}${req.body?.reason ? ` (${req.body.reason})` : ""}`
    });
    res.json({ data: await withExternalId(req, kind, await getDocument(kind, uuid)) });
  } catch (e) {
    sendError(res, e);
  }
};

// The scope depends on the payment's document: customer receipts need sales:write, supplier
// payments purchases:write.
export const voidPaymentApi = async (req, res) => {
  try {
    const uuid = await resolveUuid(req.apiClient, "payment", req.params.id);
    const payment = uuid ? await Payment.findOne({ where: { uuid }, attributes: ["invoice_id"], raw: true }) : null;
    const document = payment
      ? await Invoice.findByPk(payment.invoice_id, { attributes: ["kind", "uuid"], raw: true })
      : null;
    if (!document) return notFound(res, "Payment");
    const scope = DOCUMENT_WRITE_SCOPE[document.kind];
    if (!hasScope(req, scope)) return apiError(res, 403, `This API key does not have the "${scope}" scope`);
    const { number, amount } = await voidPaymentRecord(uuid, req.body, null);
    await logAudit(req, {
      action: "payment.void",
      entityType: "payment",
      entityId: uuid,
      summary: `Voided payment of ${amount.toFixed(2)} for ${number} from ${req.apiClient.name}`
    });
    res.json({ data: await withExternalId(req, document.kind, await getDocument(document.kind, document.uuid)) });
  } catch (e) {
    sendError(res, e);
  }
};

// --- Reports --------------------------------------------------------------------------------

export const trialBalanceApi = async (req, res) => {
  const asOf = parseDate(req.query.as_of) ?? today();
  const report = await getTrialBalance({ asOf, excludeClosing: req.query.exclude_closing === "1" });
  res.json({ data: { asOf, ...toPublic(report) } });
};

export const incomeStatementApi = async (req, res) => {
  const { fiscalYearStartMonth } = await getAccountingSettings();
  const period = resolvePeriod(req.query, fiscalYearStartMonth);
  res.json({ data: { ...period, ...toPublic(await getIncomeStatement(period)) } });
};

export const balanceSheetApi = async (req, res) => {
  const { fiscalYearStartMonth } = await getAccountingSettings();
  const asOf = parseDate(req.query.as_of) ?? today();
  res.json({ data: { asOf, ...toPublic(await getBalanceSheet({ asOf, fiscalYearStartMonth })) } });
};

export const agingApi = (kind) => async (req, res) => {
  const asOf = parseDate(req.query.as_of) ?? today();
  res.json({ data: { asOf, ...toPublic(await getAging(kind, asOf)) } });
};

// --- Change feed ----------------------------------------------------------------------------

// Systems poll this with the last id they processed to learn what changed since then.
export const listChangesApi = async (req, res) => {
  const categories = typeof req.query.categories === "string"
    ? req.query.categories.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const unknown = categories.filter((c) => !CHANGE_CATEGORIES.includes(c));
  if (unknown.length) {
    return apiError(res, 400, `Unknown categories: ${unknown.join(", ")}. Use ${CHANGE_CATEGORIES.join(", ")}`);
  }
  const after = Math.max(0, parseInt(String(req.query.after ?? "0"), 10) || 0);
  const changes = await listChangeRecords({ after, limit: positiveInt(req.query.limit, 100), categories });
  res.json({ data: changes.items, meta: { nextAfter: changes.nextAfter, hasMore: changes.hasMore } });
};
