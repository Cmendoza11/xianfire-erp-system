import { buildPagination, positiveInt } from "../helpers/pagination.js";
import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { listContacts } from "../services/contactService.js";
import { addDays, today } from "../services/dateUtils.js";
import {
  cashAccountOptions,
  createDocument,
  DOCUMENT_KINDS,
  getDocument,
  lineAccountOptions,
  listDocuments,
  recordPayment as recordPaymentRecord,
  voidDocument as voidDocumentRecord,
  voidPayment as voidPaymentRecord
} from "../services/invoiceService.js";
import { getSalesPurchaseSettings } from "../services/settingService.js";

const PAGE = {
  invoice: {
    activeMenu: "invoices",
    gridUrl: urls.invoiceGrid,
    newUrl: urls.invoiceNew,
    createApi: urls.createInvoice,
    contactNewUrl: urls.customerNew
  },
  bill: {
    activeMenu: "bills",
    gridUrl: urls.billGrid,
    newUrl: urls.billNew,
    createApi: urls.createBill,
    contactNewUrl: urls.supplierNew
  }
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" }
];

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const documentGrid = (kind) => async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const documents = await listDocuments(kind, {
    page: positiveInt(req.query.page, 1),
    limit: positiveInt(req.query.limit, 20),
    status,
    keyword: typeof req.query.keyword === "string" ? req.query.keyword : ""
  });
  res.render("documentGrid", {
    title: DOCUMENT_KINDS[kind].plural,
    activeMenu: PAGE[kind].activeMenu,
    urls,
    kind,
    config: DOCUMENT_KINDS[kind],
    page: PAGE[kind],
    documents,
    statusFilters: STATUS_FILTERS.map((f) => ({ ...f, selected: f.value === status })),
    pagination: buildPagination(documents)
  });
};

export const documentNew = (kind) => async (req, res) => {
  const config = DOCUMENT_KINDS[kind];
  const settings = await getSalesPurchaseSettings();
  const contacts = (await listContacts(config.contactType, { includeInactive: false })).map((c) => ({
    uuid: c.uuid,
    name: c.name
  }));
  const issueDate = today();
  res.render("documentNew", {
    title: `New ${config.label.toLowerCase()}`,
    activeMenu: PAGE[kind].activeMenu,
    urls,
    kind,
    config,
    page: PAGE[kind],
    hasContacts: contacts.length > 0,
    pageData: {
      kind,
      action: PAGE[kind].createApi,
      contacts,
      accounts: await lineAccountOptions(kind),
      vatRate: settings.vatRate,
      paymentTermsDays: settings.paymentTermsDays,
      issueDate,
      dueDate: addDays(issueDate, settings.paymentTermsDays)
    }
  });
};

export const documentView = (kind) => async (req, res, next) => {
  const document = await getDocument(kind, req.params.id);
  if (!document) return next();
  res.render("documentView", {
    title: document.number,
    activeMenu: PAGE[kind].activeMenu,
    urls,
    kind,
    config: DOCUMENT_KINDS[kind],
    page: PAGE[kind],
    document,
    cashAccounts: await cashAccountOptions(),
    defaultDate: document.issueDate > today() ? document.issueDate : today()
  });
};

export const createDocumentApi = (kind) => async (req, res) => {
  try {
    const { document, number, contact, total } = await createDocument(kind, req.body, req.adminUser?.admin_user_id);
    const config = DOCUMENT_KINDS[kind];
    await logAudit(req, {
      action: "document.create",
      entityType: kind,
      entityId: document.uuid,
      summary: `Issued ${config.label.toLowerCase()} ${number} to ${contact.name} for ${total.toFixed(2)} (${document.issue_date})`
    });
    res.json({ data: { ...document, number, viewUrl: config.viewUrl(document.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const recordPayment = async (req, res) => {
  try {
    const { payment, number, amount, document } = await recordPaymentRecord(req.params.id, req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "payment.record",
      entityType: "payment",
      entityId: payment.uuid,
      summary: `${document.kind === "invoice" ? "Received" : "Paid"} ${amount.toFixed(2)} for ${number} on ${payment.payment_date}`
    });
    res.json({ data: payment });
  } catch (e) {
    sendError(res, e);
  }
};

export const voidPayment = async (req, res) => {
  try {
    const { number, amount } = await voidPaymentRecord(req.params.id, req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "payment.void",
      entityType: "payment",
      entityId: req.params.id,
      summary: `Voided payment of ${amount.toFixed(2)} for ${number}`
    });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};

export const voidDocument = async (req, res) => {
  try {
    const { number, document, config } = await voidDocumentRecord(req.params.id, req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "document.void",
      entityType: document.kind,
      entityId: document.uuid,
      summary: `Voided ${config.label.toLowerCase()} ${number} on ${document.voided_on}${req.body?.reason ? ` (${req.body.reason})` : ""}`
    });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};
