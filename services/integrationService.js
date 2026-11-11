import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Op, UniqueConstraintError } from "sequelize";
import { Account, ApiClient, AuditLog, IntegrationReference } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";

// What each connected system may do. Every client gets "read"; writes are granted per area so,
// for example, a payroll system can post journal entries but cannot issue sales invoices.
export const SCOPES = [
  { value: "read", label: "Read", description: "Chart of accounts, contacts, journal entries, invoices, bills, reports and the change feed" },
  { value: "contacts:write", label: "Customers & suppliers", description: "Create and update customers and suppliers" },
  { value: "journal:write", label: "Journal entries", description: "Post and reverse journal entries (e.g. payroll, inventory, depreciation)" },
  { value: "sales:write", label: "Sales", description: "Issue and void sales invoices; record and void customer payments" },
  { value: "purchases:write", label: "Purchases", description: "Issue and void supplier bills; record and void supplier payments" }
];
const SCOPE_VALUES = SCOPES.map((s) => s.value);

// Which write scope covers documents of each kind.
export const DOCUMENT_WRITE_SCOPE = { invoice: "sales:write", bill: "purchases:write" };

// Entity types that may carry an external id, as stored in integration_reference.entity_type.
export const EXTERNAL_ENTITY_TYPES = ["contact", "journal_entry", "invoice", "bill", "payment"];

export class IntegrationConflictError extends Error {}

const SYSTEM_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const KEY_PATTERN = /^xfk_([0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;
const MAX_EXTERNAL_ID_LENGTH = 100;
// last_used_at is informational, so it is written at most once a minute per client.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Keys carry 256 random bits, so a plain SHA-256 (not a slow password hash) is enough to store them.
function generateKey() {
  const prefix = randomBytes(6).toString("hex");
  const key = `xfk_${prefix}_${randomBytes(32).toString("base64url")}`;
  return { key, prefix, hash: sha256(key) };
}

const scopeList = (value) => String(value ?? "").split(/\s+/).filter(Boolean);

function toClient(row) {
  const scopes = scopeList(row.scopes);
  return {
    uuid: row.uuid,
    name: row.name,
    systemCode: row.system_code,
    keyPrefix: row.key_prefix,
    scopes,
    scopeLabels: SCOPES.filter((s) => scopes.includes(s.value)).map((s) => s.label),
    status: row.status ? 1 : 0,
    lastUsedAt: row.last_used_at,
    createdAt: row.createdAt ?? row.created_at,
    editUrl: urls.integrationEdit(row.uuid),
    updateApi: urls.updateIntegration(row.uuid),
    rotateKeyApi: urls.rotateIntegrationKey(row.uuid)
  };
}

// Accepts { scopes: [...] } from API callers, or scope_<name> fields from the admin form.
function parseScopes(data) {
  const requested = Array.isArray(data.scopes)
    ? data.scopes.map(String)
    : SCOPE_VALUES.filter((s) => [1, "1", true, "true", "on"].includes(data[`scope_${s}`]));
  const unknown = requested.filter((s) => !SCOPE_VALUES.includes(s));
  if (unknown.length) {
    throw new AccountingValidationError(`Unknown scope: ${unknown.join(", ")}`);
  }
  return SCOPE_VALUES.filter((s) => s === "read" || requested.includes(s));
}

function parseName(value) {
  const name = String(value ?? "").trim();
  if (!name) throw new AccountingValidationError("System name is required");
  if (name.length > 100) throw new AccountingValidationError("System name must be at most 100 characters");
  return name;
}

export async function listApiClients() {
  const rows = await ApiClient.findAll({ order: [["name", "ASC"]], raw: true });
  return rows.map(toClient);
}

export async function getApiClient(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const row = await ApiClient.findOne({ where: { uuid }, raw: true });
  return row ? toClient(row) : null;
}

export async function createApiClient(data, adminUserId) {
  const name = parseName(data?.name);
  const systemCode = String(data?.system_code ?? "").trim().toLowerCase();
  if (!SYSTEM_CODE_PATTERN.test(systemCode)) {
    throw new AccountingValidationError(
      "System code must be 2-40 characters: lowercase letters, digits, - or _, starting with a letter"
    );
  }
  if (await ApiClient.findOne({ where: { system_code: systemCode }, attributes: ["api_client_id"] })) {
    throw new AccountingValidationError(`System code "${systemCode}" is already used`);
  }
  const scopes = parseScopes(data);
  const { key, prefix, hash } = generateKey();
  const row = await ApiClient.create({
    name,
    system_code: systemCode,
    key_prefix: prefix,
    key_hash: hash,
    scopes: scopes.join(" "),
    created_by: adminUserId ?? null
  });
  return { client: toClient(row.get({ plain: true })), apiKey: key };
}

export async function updateApiClient(uuid, data) {
  const row = uuid && UUID_PATTERN.test(uuid) ? await ApiClient.findOne({ where: { uuid } }) : null;
  if (!row) throw new AccountingValidationError("Integration not found");
  const before = toClient(row.get({ plain: true }));
  const changes = {};
  if (data?.name !== undefined) changes.name = parseName(data.name);
  if (data?.status !== undefined) changes.status = [1, "1", true, "true"].includes(data.status);
  if (data?.scopes !== undefined || SCOPE_VALUES.some((s) => data?.[`scope_${s}`] !== undefined)) {
    changes.scopes = parseScopes(data).join(" ");
  }
  await row.update(changes);
  return { before, after: toClient(row.get({ plain: true })) };
}

// Replaces the key at once: the old key stops working on the next request.
export async function rotateApiKey(uuid) {
  const row = uuid && UUID_PATTERN.test(uuid) ? await ApiClient.findOne({ where: { uuid } }) : null;
  if (!row) throw new AccountingValidationError("Integration not found");
  const { key, prefix, hash } = generateKey();
  await row.update({ key_prefix: prefix, key_hash: hash });
  return { client: toClient(row.get({ plain: true })), apiKey: key };
}

// Returns the active client that owns the key, or null. The hash comparison is constant-time.
export async function authenticateApiKey(key) {
  const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
  if (!match) return null;
  const row = await ApiClient.findOne({ where: { key_prefix: match[1], status: true }, raw: true });
  if (!row) return null;
  const expected = Buffer.from(row.key_hash, "hex");
  const actual = Buffer.from(sha256(key), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_WRITE_INTERVAL_MS) {
    await ApiClient.update({ last_used_at: new Date() }, { where: { api_client_id: row.api_client_id } });
  }
  return {
    apiClientId: row.api_client_id,
    uuid: row.uuid,
    name: row.name,
    systemCode: row.system_code,
    scopes: scopeList(row.scopes)
  };
}

// --- External ids ---------------------------------------------------------------------------

export function normalizeExternalId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AccountingValidationError("external_id must be a string");
  }
  const id = String(value).trim();
  if (!id) return null;
  if (id.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new AccountingValidationError(`external_id must be at most ${MAX_EXTERNAL_ID_LENGTH} characters`);
  }
  return id;
}

// Runs `create` at most once per (client, entity type, external id). The id is reserved first, so
// two concurrent retries cannot both post; the loser gets the first result or a 409 while the
// first request is still running. `create` must resolve to an object with the new record's uuid.
export async function createOnce(client, entityType, externalId, create) {
  if (!externalId) return { duplicate: false, uuid: (await create()).uuid };
  let reservation;
  try {
    reservation = await IntegrationReference.create({
      api_client_id: client.apiClientId,
      entity_type: entityType,
      external_id: externalId
    });
  } catch (e) {
    if (!(e instanceof UniqueConstraintError)) throw e;
    const existing = await IntegrationReference.findOne({
      where: { api_client_id: client.apiClientId, entity_type: entityType, external_id: externalId },
      raw: true
    });
    if (!existing?.entity_uuid) {
      throw new IntegrationConflictError(`A request with external_id "${externalId}" is still being processed`);
    }
    return { duplicate: true, uuid: existing.entity_uuid };
  }
  let uuid;
  try {
    ({ uuid } = await create());
  } catch (e) {
    // Nothing was posted, so the external id is released and the caller may retry.
    await reservation.destroy();
    throw e;
  }
  // If this write fails the reservation stays pending: retries get a 409 rather than a second posting.
  await reservation.update({ entity_uuid: uuid });
  return { duplicate: false, uuid };
}

// Links an existing record to an external id (used when a contact is created without one first).
export async function linkExternalId(client, entityType, externalId, uuid) {
  try {
    await IntegrationReference.create({
      api_client_id: client.apiClientId,
      entity_type: entityType,
      external_id: externalId,
      entity_uuid: uuid
    });
  } catch (e) {
    if (e instanceof UniqueConstraintError) {
      throw new IntegrationConflictError(`external_id "${externalId}" is already linked to another record`);
    }
    throw e;
  }
}

// A path or body id may be our uuid or the calling system's own external id for the record.
export async function resolveUuid(client, entityTypes, id) {
  const value = String(id ?? "").trim();
  if (!value) return null;
  if (UUID_PATTERN.test(value)) return value;
  const ref = await IntegrationReference.findOne({
    where: {
      api_client_id: client.apiClientId,
      entity_type: { [Op.in]: [].concat(entityTypes) },
      external_id: value,
      entity_uuid: { [Op.ne]: null }
    },
    raw: true
  });
  return ref?.entity_uuid ?? null;
}

// The calling system's external ids for a set of records, keyed by uuid.
export async function externalIdsFor(client, entityTypes, uuids) {
  const list = [...new Set(uuids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await IntegrationReference.findAll({
    where: {
      api_client_id: client.apiClientId,
      entity_type: { [Op.in]: [].concat(entityTypes) },
      entity_uuid: { [Op.in]: list }
    },
    attributes: ["entity_uuid", "external_id"],
    raw: true
  });
  return new Map(rows.map((r) => [r.entity_uuid, r.external_id]));
}

// Other systems know accounts by code (e.g. "1010"); the ledger services expect uuids.
export async function resolveAccountUuids(values) {
  const codes = [...new Set(values.filter((v) => v && !UUID_PATTERN.test(String(v))).map(String))];
  const rows = codes.length
    ? await Account.findAll({ where: { code: { [Op.in]: codes } }, attributes: ["code", "uuid"], raw: true })
    : [];
  const byCode = new Map(rows.map((r) => [r.code, r.uuid]));
  return (value) => {
    if (!value) return null;
    const text = String(value).trim();
    return UUID_PATTERN.test(text) ? text : byCode.get(text) ?? null;
  };
}

// --- Change feed ----------------------------------------------------------------------------

// Bookkeeping events from the audit log. Logins, users and settings are internal and left out.
const FEED_CATEGORIES = ["account", "journal", "contact", "document", "payment", "bankrec", "period"];

export async function listChanges({ after = 0, limit = 100, categories = [] } = {}) {
  const safeLimit = Math.min(Math.max(1, limit || 100), 500);
  const wanted = categories.length ? FEED_CATEGORIES.filter((c) => categories.includes(c)) : FEED_CATEGORIES;
  if (!wanted.length) return { items: [], nextAfter: after, hasMore: false };
  const rows = await AuditLog.findAll({
    where: {
      audit_log_id: { [Op.gt]: Math.max(0, after || 0) },
      [Op.or]: wanted.map((c) => ({ action: { [Op.like]: `${c}.%` } }))
    },
    order: [["audit_log_id", "ASC"]],
    // One extra row tells whether another page exists.
    limit: safeLimit + 1,
    raw: true
  });
  const page = rows.slice(0, safeLimit);
  return {
    items: page.map((r) => ({
      id: r.audit_log_id,
      occurredAt: r.createdAt,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      // Staff emails stay internal; other systems only learn whether a person or which system acted.
      actor: String(r.user_email ?? "").startsWith("api:") ? r.user_email : "user"
    })),
    nextAfter: page.length ? page[page.length - 1].audit_log_id : after,
    hasMore: rows.length > safeLimit
  };
}

export const CHANGE_CATEGORIES = FEED_CATEGORIES;
