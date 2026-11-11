# XianFire Accounting — ERP Integration API (v1)

This is the API the other ERP systems (for example Inventory, Payroll, Point of Sale, Procurement)
use to share data with the accounting system. Every system gets its own API key and permissions.

- **Base URL:** `http://<accounting-server>:3000/api/v1`
- **Format:** JSON in, JSON out (`Content-Type: application/json` on every POST/PATCH)
- **Dates:** `YYYY-MM-DD` · **Amounts:** numbers in the ledger currency (e.g. `1500.50`)

## 1. Getting a key

An administrator opens **Administration → ERP Integrations → New integration**, enters the system
name and a short code (e.g. `inventory`), ticks the permissions, and copies the key it shows. The
key is shown only once. **Keep it on your server**: don't put it in browser JavaScript or a mobile app.

Send it with every request:

```
Authorization: Bearer xfk_1a2b3c4d5e6f_...
```

(`X-API-Key: xfk_...` also works.)

| Scope | Allows |
|---|---|
| `read` (always granted) | Chart of accounts, contacts, journal entries, invoices, bills, reports, change feed |
| `contacts:write` | Create and update customers and suppliers |
| `journal:write` | Post and reverse journal entries |
| `sales:write` | Issue and void sales invoices; record and void customer payments |
| `purchases:write` | Issue and void supplier bills; record and void supplier payments |

Everything an integration changes appears in the accounting **Audit Log** as `api:<code>`.

## 2. Ids: uuids, account codes and your own ids

- Every record has a `uuid`. It is the permanent id.
- **Accounts** can be referenced by **code** (`"1010"`) or uuid, in any `account` / `cash_account`
  field and in `GET /accounts/:id`.
- **Your own ids (`external_id`)**: send your system's id when creating a contact, journal entry,
  invoice, bill or payment. Then:
  - you can use it in place of the uuid in any path or reference (e.g. `GET /invoices/SALE-5001`,
    `"contact": "CUST-1"`). External ids belong to your system only, so other systems can't see them.
  - **retries are safe**: if the same `external_id` is sent again, nothing new is posted. You get
    `200` with `"meta": { "duplicate": true }` and the record from the first request. While the
    first request is still running, a parallel retry gets `409`; wait briefly and retry.
  - if a request fails validation (`400`), nothing is posted and the same `external_id` can be
    reused after fixing the data.

Always send an `external_id` for anything that posts to the ledger. It is what keeps a network
timeout and retry from booking the same sale twice.

## 3. Responses and errors

```json
{ "data": { ... }, "meta": { ... } }
{ "error": { "status": 400, "message": "Entry is not balanced: total debit 10.00 vs total credit 9.00" } }
```

| Status | Meaning |
|---|---|
| 200 | OK (or a duplicate of an earlier create: `meta.duplicate = true`) |
| 201 | Created |
| 400 | Validation failed; `message` says why (unbalanced, closed period, inactive account, …) |
| 401 | Missing, wrong or revoked API key |
| 403 | The key lacks the scope for this action |
| 404 | Not found |
| 409 | `external_id` conflict (still processing, or already used for another record) |
| 415 | Body is not `application/json` |

All accounting rules still apply: entries must balance, closed periods are locked, inactive accounts
cannot be used, payments cannot exceed the balance.

## 4. Endpoints

### Connection check

- `GET /health` needs no key and answers `{ "data": { "status": "ok" } }` — point your monitoring at it.
- `GET /` (with your key) returns your system name, scopes, company name, currency and the server date.
  Call it once at start-up to confirm the key and its permissions.

### Chart of accounts (`read`)

| | |
|---|---|
| `GET /accounts` | All active accounts with balances (`?include_inactive=1` for all) |
| `GET /accounts/:codeOrUuid` | One account, e.g. `/accounts/1010` |

### Customers and suppliers

| | |
|---|---|
| `GET /contacts?type=customer\|supplier` | Active contacts (both types if `type` is omitted; `?include_inactive=1` for all); includes `outstanding` balance |
| `GET /contacts/:id` | One contact (uuid or your external id) |
| `POST /contacts` | `contacts:write` |
| `PATCH /contacts/:id` | `contacts:write`; send only the fields to change. Sending `external_id` links an existing contact to your id |

```json
POST /contacts
{ "type": "customer", "name": "Juan Dela Cruz", "email": "juan@example.com",
  "phone": "0917-000-0000", "address": "Calapan City", "tin": "123-456-789-000",
  "external_id": "CUST-1" }
```

To sync master data, `POST` with your id. If you get `duplicate: true`, the contact already exists:
`PATCH /contacts/CUST-1` with the changes.

### Journal entries (`journal:write` to post)

| | |
|---|---|
| `GET /journal-entries?page=1&limit=20&keyword=` | List, newest first |
| `GET /journal-entries/:id` | One entry with its lines |
| `POST /journal-entries` | Post a balanced entry |
| `POST /journal-entries/:id/reverse` | Post the reversing entry `{ "entry_date": "2026-11-30", "reason": "..." }` |

```json
POST /journal-entries
{
  "entry_date": "2026-11-05",
  "reference": "DR-1001",
  "description": "Cost of goods sold for delivery DR-1001",
  "external_id": "INV-MOVE-1001",
  "lines": [
    { "account": "5000", "debit": 1500, "description": "Cost of goods sold" },
    { "account": "1200", "credit": 1500, "description": "Merchandise inventory" }
  ]
}
```

Each line has either `debit` or `credit`, and the totals must be equal. Typical uses:

| System | Debit | Credit |
|---|---|---|
| Inventory: goods delivered | 5000 Cost of Goods Sold | 1200 Merchandise Inventory |
| Inventory: stock received (unbilled) | 1200 Merchandise Inventory | 2100 Accrued Expenses |
| Payroll: salaries | 6000 Salaries and Wages Expense | 1010 Cash in Bank, 2300 Withholding Tax Payable, 2400 SSS/PhilHealth/Pag-IBIG Payable |

(These are the default chart's codes; check `GET /accounts` for the real ones.)

### Sales invoices (`sales:write`) and supplier bills (`purchases:write`)

Same endpoints under `/invoices` and `/bills`:

| | |
|---|---|
| `GET /invoices?status=open\|overdue\|paid\|void&page=&limit=&keyword=` | List |
| `GET /invoices/:id` | One document with lines and payments |
| `POST /invoices` | Issue: posts Dr Accounts Receivable / Cr revenue + Output VAT |
| `POST /invoices/:id/payments` | Record a payment: Dr cash / Cr Accounts Receivable |
| `POST /invoices/:id/void` | Void (void its payments first) `{ "void_date": "...", "reason": "..." }` |
| `POST /payments/:id/void` | Void a payment `{ "void_date": "..." }` |

```json
POST /invoices
{
  "contact": "CUST-1",
  "issue_date": "2026-11-05",
  "due_date": "2026-12-05",
  "reference": "OR-5001",
  "vat": true,
  "external_id": "SALE-5001",
  "lines": [ { "account": "4000", "description": "Item A", "quantity": 2, "unit_price": 500 } ]
}

POST /invoices/SALE-5001/payments
{ "payment_date": "2026-11-05", "amount": 1120, "cash_account": "1000",
  "reference": "OR-5001", "external_id": "PAY-5001" }
```

- `contact`: customer (invoices) or supplier (bills), by uuid or your external id.
- Invoice lines use **revenue** accounts. Bill lines use **expense** or non-cash **asset** accounts.
- `vat: true` adds VAT at the rate set in Accounting Settings. `due_date` defaults to the payment terms.
- `cash_account` must be an account marked *Cash or bank account* (e.g. 1000, 1010).
- The response includes `balance` and `status` (`open` → `paid` when fully paid).

### Reports (`read`)

| | |
|---|---|
| `GET /reports/trial-balance?as_of=2026-11-30&exclude_closing=1` | Trial balance |
| `GET /reports/income-statement?from=2026-01-01&to=2026-11-30` | Income statement (defaults to fiscal year to date) |
| `GET /reports/balance-sheet?as_of=2026-11-30` | Balance sheet |
| `GET /reports/ar-aging?as_of=` / `GET /reports/ap-aging?as_of=` | Receivables / payables aging |

### Change feed (`read`)

Poll this to learn what changed in accounting, whether it came from a user or another system:

```
GET /changes?after=0&limit=100&categories=document,payment
```

```json
{ "data": [ { "id": 41, "occurredAt": "2026-11-05T14:11:02.000Z", "action": "document.create",
              "entityType": "invoice", "entityId": "<uuid>", "summary": "Issued sales invoice INV-000012 ...",
              "actor": "api:pos" } ],
  "meta": { "nextAfter": 41, "hasMore": false } }
```

Store `meta.nextAfter` and send it as `after` next time. Keep polling while `hasMore` is true.
Categories: `account, journal, contact, document, payment, bankrec, period`. Fetch the record by
`entityId` for its current state. Actions include `document.create`, `document.void`,
`payment.record`, `payment.void`, `journal.post`, `journal.reverse`, `contact.create`,
`contact.update`, `account.update` and `period.close`.

## 5. Example (curl)

```bash
KEY="xfk_..."
curl -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/accounts/1010

curl -X POST http://localhost:3000/api/v1/journal-entries \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"entry_date":"2026-11-05","description":"Payroll Nov 1-15","external_id":"PAYRUN-2026-11A",
       "lines":[{"account":"6000","debit":50000},{"account":"1010","credit":50000}]}'
```

## 6. Going live checklist

For the accounting team:

1. `npm run migrate` once on the server (creates the `api_client` and `integration_reference` tables).
2. Put the server behind HTTPS (a reverse proxy such as Nginx or Caddy): keys travel in request headers.
3. Create one integration per system with only the scopes it needs. Revoke or replace a key from
   **Administration → ERP Integrations** the moment it may have leaked.
4. Watch **Audit Log → ERP integrations** for key changes, and the other categories for what each
   system posts (`api:<code>`).

For each connecting system:

1. Keep the key in server-side configuration (environment variable or secrets store), never in code.
2. Call `GET /` at start-up and fail loudly if it is not `200`.
3. Send an `external_id` on every create, and treat `200` + `duplicate: true` as success.
4. On `400`, show the message to a person and do not retry unchanged: it is an accounting rule
   (closed period, inactive account, unbalanced entry), not a transient fault. Retry only on
   network errors, `409` and `5xx`.
5. Poll `GET /changes` with your stored cursor (every 30–60 seconds is plenty) instead of re-reading lists.

## 7. Calling from a browser front end

Server-to-server calls need no setup. If another system's web page must call this API directly
(not recommended, because the key would be visible), list its origin in `.env`:
`API_CORS_ORIGINS=http://localhost:5173`.
