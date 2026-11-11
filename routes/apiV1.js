// ERP integration API. Every route needs an API key (Administration > ERP Integrations); write
// routes also need the matching scope. See docs/ERP-API.md for the request and response formats.
import express from "express";
import {
  agingApi,
  apiInfo,
  balanceSheetApi,
  createContactApi,
  createDocumentApi,
  createJournalEntryApi,
  getAccountApi,
  getContactApi,
  getDocumentApi,
  getJournalEntryApi,
  incomeStatementApi,
  listAccountsApi,
  listChangesApi,
  listContactsApi,
  listDocumentsApi,
  listJournalEntriesApi,
  recordPaymentApi,
  reverseJournalEntryApi,
  trialBalanceApi,
  updateContactApi,
  voidDocumentApi,
  voidPaymentApi
} from "../controllers/apiV1Controller.js";
import { apiCors, requireApiKey, requireScope } from "../middleware/apiKey.js";
import { requireJson } from "../middleware/auth.js";

const router = express.Router();

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const write = (scope) => [requireScope(scope), requireJson];

router.use(apiCors);
// Liveness check for monitors and load balancers: no key needed, and nothing about the ledger is revealed.
router.get("/health", (req, res) => res.json({ data: { status: "ok" } }));
router.use(requireApiKey);
router.use(requireScope("read"));

router.get("/", h(apiInfo));

router.get("/accounts", h(listAccountsApi));
router.get("/accounts/:id", h(getAccountApi));

router.get("/contacts", h(listContactsApi));
router.get("/contacts/:id", h(getContactApi));
router.post("/contacts", ...write("contacts:write"), h(createContactApi));
router.patch("/contacts/:id", ...write("contacts:write"), h(updateContactApi));

router.get("/journal-entries", h(listJournalEntriesApi));
router.get("/journal-entries/:id", h(getJournalEntryApi));
router.post("/journal-entries", ...write("journal:write"), h(createJournalEntryApi));
router.post("/journal-entries/:id/reverse", ...write("journal:write"), h(reverseJournalEntryApi));

for (const [path, kind, scope] of [["invoices", "invoice", "sales:write"], ["bills", "bill", "purchases:write"]]) {
  router.get(`/${path}`, h(listDocumentsApi(kind)));
  router.get(`/${path}/:id`, h(getDocumentApi(kind)));
  router.post(`/${path}`, ...write(scope), h(createDocumentApi(kind)));
  router.post(`/${path}/:id/payments`, ...write(scope), h(recordPaymentApi(kind)));
  router.post(`/${path}/:id/void`, ...write(scope), h(voidDocumentApi(kind)));
}
// The scope (sales or purchases) is checked inside, once the payment's document is known.
router.post("/payments/:id/void", requireJson, h(voidPaymentApi));

router.get("/reports/trial-balance", h(trialBalanceApi));
router.get("/reports/income-statement", h(incomeStatementApi));
router.get("/reports/balance-sheet", h(balanceSheetApi));
router.get("/reports/ar-aging", h(agingApi("invoice")));
router.get("/reports/ap-aging", h(agingApi("bill")));

router.get("/changes", h(listChangesApi));

router.use((req, res) => res.status(404).json({ error: { status: 404, message: "Not found" } }));

export default router;
