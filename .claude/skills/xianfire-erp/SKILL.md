---
name: xianfire-erp
description: Use when reading, changing, debugging or reviewing any code in the XianFires ERP accounting project (Express, .xian Handlebars views, Sequelize, MySQL), including journal entries, invoices, bills, payments, bank reconciliation, period closing, reports, users, audit log and the /api/v1 integration API.
---

# XianFires ERP Working Rules

Double-entry accounting app. Express 4, ESM, `.xian` (Handlebars) views, Sequelize 6 on MySQL 8. No test suite, no bundler, no client framework.

Request flow: `routes/index.js` → `controllers/` (HTTP and audit) → `services/` (every accounting rule) → `models/`.

## 1. Read only what the task needs

1. Find the task in the map below and open those files only.
2. Files under 200 lines: read once, whole.
3. Files over 200 lines: run Grep for `^export` on the file, then Read with offset and limit around the function.

| Over 200 lines | Lines |
|---|---|
| `services/invoiceService.js` | 609 |
| `controllers/apiV1Controller.js` | 438 |
| `services/journalService.js` | 389 |
| `services/reportService.js` | 313 |
| `services/integrationService.js` | 313 |
| `migrate.js` | 233 |
| `services/bankRecService.js` | 225 |
| `public/js/admin.js` | 224 |

4. `index.js`, `migrate.js`, `models/db.js` and `routes/index.js` open with a 24-line licence. Start them at offset 25.
5. Look up one route or URL with Grep on `routes/index.js` or `routes/urls.js`.
6. Put independent reads in one message. An Edit that succeeded needs no re-read.
7. Work inline. Spawn subagents only when the user asks for them.
8. Off limits: `.env` (secrets), `package-lock.json`, `node_modules/`, `docs/*.docx`, `docs/*.pdf`, `docs/diagrams/`.

## 2. Task map

| Task | Files |
|---|---|
| Manual journal, reversal, delete | `services/journalService.js`, `controllers/journalController.js`, `public/js/journal-entry.js` |
| Invoice, bill, payment, void | `services/invoiceService.js`, `controllers/documentController.js`, `public/js/document-form.js`, `views/documentNew.xian`, `views/documentView.xian` |
| VAT summary report | `services/taxService.js` |
| Financial reports | `services/reportService.js`, `controllers/reportController.js`, `views/report*.xian` |
| AR/AP aging, sales and purchase books | `getAging` and `getDocumentBook` in `services/invoiceService.js` |
| Bank reconciliation | `services/bankRecService.js`, `controllers/bankRecController.js`, `public/js/reconciliation.js` |
| Period closing | `services/periodService.js`, `controllers/periodController.js`, `public/js/period-closing.js` |
| Chart of accounts | `services/accountService.js`, `controllers/accountController.js`, `public/js/account-form.js` |
| Customers, suppliers | `services/contactService.js`, `controllers/contactController.js` |
| Settings, number prefixes | `services/settingService.js`, `controllers/settingController.js` |
| Users, roles, login | `services/userService.js`, `controllers/userController.js`, `controllers/authController.js`, `middleware/auth.js` |
| Audit log | `services/auditService.js`, `controllers/auditController.js` |
| `/api/v1` | `routes/apiV1.js`, `controllers/apiV1Controller.js`, `services/integrationService.js`, `middleware/apiKey.js`, `docs/ERP-API.md` |
| API key admin pages | `controllers/integrationController.js`, `views/integrationForm.xian`, `public/js/integration.js` |
| Sidebar menu | `views/partials/adminNav.xian`, plus `NAV_SECTIONS` in `helpers/handlebars.js` for each new `activeMenu` value |
| Theme, shell layout | `public/css/admin.css` (tokens in `:root`), `views/partials/head.xian` (Tailwind colours must match) |

## 3. Shape of a new endpoint

Build these in order, copying the nearest existing feature:

1. **URL** in `routes/urls.js`. Views and controllers never hardcode a path.
2. **Route** in `routes/index.js`, handler wrapped in `h()`. Guards: pages use `read`, `write` or `admin`. JSON writes use `...writeJsonApi` or `...adminJsonApi`. Body-less DELETE uses `...writeApi`.
3. **Service** holds the rule, throws `AccountingValidationError` with a message the user can read, and returns camelCase objects with ready-made URLs (see `toEntry`).
4. **Controller**: render with `title`, `activeMenu` and `urls`. JSON writes follow this shape:

```js
try {
  const result = await serviceCall(req.body, req.adminUser?.admin_user_id);
  await logAudit(req, { action: "area.verb", entityType, entityId: result.uuid, summary, details });
  res.json({ data: result });
} catch (e) {
  sendError(res, e); // 400 for AccountingValidationError, otherwise rethrown to the error handler
}
```

5. **New audit action** goes in `ACTION_LABELS`. A new category goes in `AUDIT_CATEGORIES`.

Conventions: URLs and APIs expose `uuid`, and integer keys stay internal. Raw SQL uses `replacements`, and only clamped integers such as `LIMIT` are interpolated. Errors are `{ error: { status, message } }`, successes are `{ data }`. Comments give the reason in one line.

Write new models and controllers by hand from a neighbouring file. `create.js` generates a Firestore note and a sample `Student` model.

## 4. Ledger invariants

Every change keeps all of these true:

1. Money is compared in integer cents with `toCents` and stored with `.toFixed(2)`.
2. An entry has at least two lines, each line is a debit or a credit, and totals are equal.
3. Automatic posting calls `postEntry(transaction, header, lines)` with `debitCents` and `creditCents`. Reversals call `postReversal`.
4. Posted entries are never updated. Corrections are reversals, and entries in `DOCUMENT_ENTRY_TYPES` change only by voiding their document.
5. Every posting date passes `assertPeriodOpen`.
6. Header, lines and the document update share one `sequelize.transaction`.
7. Read-then-write on a document balance or reconciliation locks the row with `Transaction.LOCK.UPDATE` inside that transaction.
8. Routes enforce roles. `can.write` and `can.admin` in views only hide controls.
9. Session writes stay JSON-only through `requireJson`, which is the CSRF defence.
10. Every state change is recorded with `logAudit` after it succeeds.

## 5. Schema changes

`sequelize.sync()` in `migrate.js` creates missing tables and never alters existing ones.

| Change | Do this |
|---|---|
| New table | Add the model, then import, associate and export it in `models/index.js` |
| New column on an existing table | Add it to the model and append a `DATA_MIGRATIONS` step using `addColumnIfMissing` |
| New CHECK | Append to `CHECK_CONSTRAINTS` |
| New `entry_type` value | Migration step that drops the CHECK (see `accounting-1.3.0`), then update `CHECK_CONSTRAINTS`, the model's `isIn`, `ENTRY_TYPE_LABELS` and, if document-owned, `DOCUMENT_ENTRY_TYPES` |

Step names are `accounting-<version>-<slug>`. Append new steps and leave shipped ones unchanged. Run ALTER statements without the transaction, because MySQL DDL commits implicitly.

## 6. Views and page scripts

- Pages open with `{{> head}}`, `{{> adminHeader}}`, `{{> adminNav}}`, `{{> pageHeading}}` and reuse the `card`, `btn`, `input`, `data-table` and `notice` classes.
- Server data reaches scripts through `<script type="application/json" id="x-page-data">{{ json pageData }}</script>`, which is safe against `</script>`.
- Page scripts are IIFEs in `public/js/` that select elements by `data-*` and call `XF.api`, `XF.toast`, `XF.confirm`, `XF.setLoading`, `XF.validateForm`, `XF.formToJson` and `XF.errorMessage`.

## 7. `/api/v1`

Handlers call the same services as the admin pages. Write routes use `...write("<scope>")`. `IntegrationConflictError` maps to 409. Copy `createJournalEntryApi` for `external_id` retries. `GET /health` is the only route before `requireApiKey`. Update `docs/ERP-API.md` in the same change.

To test the API without touching real data: `DB_NAME=xianfires_erp_qa node migrate.js --yes`, run the app with `DB_NAME=xianfires_erp_qa`, issue a key through `POST /api/integrations`, and drop the scratch database afterwards. External ids belong to one key, so a second client cannot resolve another's `CUST-1`.

## 8. Known traps

| Symptom | Cause | Fix |
|---|---|---|
| Request hangs after an async error | Handler missing `h()` (Express 4) | Wrap it in `h()` |
| Partial edit does not show | Partials load once at boot and nodemon watches JS and JSON only | Restart the server |
| Logged out after restart | Sessions live in the memory store | Log in again |
| New column missing in MySQL | `sync()` never alters tables | Add a migration step (section 5) |
| `created_at` undefined on a `raw: true` Sequelize row | Raw rows use attribute names | Read `createdAt` |
| Bills not found in a bill table | Invoices and bills share `Invoice`, split by `kind` | Filter on `DOCUMENT_KINDS` |
| README edit absent from git | `README.md` is in `.gitignore` | Expected |

## 9. Verify, then report

1. Always run the syntax check. It prints only failures:

```bash
for f in *.js controllers/*.js services/*.js models/*.js routes/*.js middleware/*.js helpers/*.js public/js/*.js; do node --check "$f" || echo "FAIL $f"; done
```

2. Runtime check needs MySQL on port 3306 (Laragon). If the schema changed, run `npm run migrate -- --yes`. Start with `npm run xian` and exercise the changed route as a logged-in user.
3. After a posting change, post one document and open the Trial Balance. Debits must equal credits.
4. When MySQL is off, report the work as "syntax-checked only, not run".

Final message: what changed with file links, how it was verified, what remains unverified.

## 10. Keep memory current

Before ending a session with unfinished work, overwrite the `current-work` memory with the branch, what is done, what is unverified and the next step. Save a new memory for each decision or trap the code does not show.
