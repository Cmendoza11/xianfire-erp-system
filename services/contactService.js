import { QueryTypes } from "sequelize";
import { sequelize, Contact, Invoice } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";

export const CONTACT_TYPES = {
  customer: { label: "Customer", plural: "Customers", documentKind: "invoice" },
  supplier: { label: "Supplier", plural: "Suppliers", documentKind: "bill" }
};

const editUrl = (type, uuid) => (type === "customer" ? urls.customerEdit(uuid) : urls.supplierEdit(uuid));

function toContact(row) {
  return {
    contactId: row.contact_id,
    uuid: row.uuid,
    type: row.type,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    tin: row.tin,
    status: Number(row.status),
    outstanding: Number(row.outstanding ?? 0),
    openDocuments: Number(row.open_documents ?? 0),
    editUrl: editUrl(row.type, row.uuid),
    updateApi: urls.updateContact(row.uuid),
    deleteApi: urls.deleteContact(row.uuid)
  };
}

// Contacts with their unpaid balance across open invoices or bills.
export async function listContacts(type, { includeInactive = true } = {}) {
  const rows = await sequelize.query(
    `SELECT c.*,
       COALESCE(SUM(CASE WHEN i.status = 'open' THEN i.total - i.amount_paid ELSE 0 END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN i.status = 'open' THEN 1 ELSE 0 END), 0) AS open_documents
     FROM contact c
     LEFT JOIN invoice i ON i.contact_id = c.contact_id
     WHERE c.type = ? ${includeInactive ? "" : "AND c.status = 1"}
     GROUP BY c.contact_id
     ORDER BY c.name`,
    { replacements: [type], type: QueryTypes.SELECT }
  );
  return rows.map(toContact);
}

export async function getContact(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const row = await Contact.findOne({ where: { uuid }, raw: true });
  return row ? toContact(row) : null;
}

function normalize(type, data, current) {
  const name = String(data.name ?? current?.name ?? "").trim();
  if (!name) {
    throw new AccountingValidationError(`${CONTACT_TYPES[type].label} name is required`);
  }
  const email = String(data.email ?? current?.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountingValidationError("Enter a valid email address");
  }
  const text = (key) => {
    const value = data[key] === undefined ? current?.[key] : data[key];
    return value ? String(value).trim() || null : null;
  };
  return {
    name,
    email: email || null,
    phone: text("phone"),
    address: text("address"),
    tin: text("tin"),
    status:
      data.status === undefined ? current?.status ?? 1 : [1, "1", true, "true"].includes(data.status) ? 1 : 0
  };
}

export async function createContact(type, data) {
  if (!CONTACT_TYPES[type]) {
    throw new AccountingValidationError("Invalid contact type");
  }
  const contact = await Contact.create({ type, ...normalize(type, data ?? {}) });
  return contact.get({ plain: true });
}

export async function updateContact(uuid, data) {
  const current = UUID_PATTERN.test(uuid) ? await Contact.findOne({ where: { uuid } }) : null;
  if (!current) {
    throw new AccountingValidationError("Contact not found");
  }
  const before = current.get({ plain: true });
  await current.update(normalize(current.type, data ?? {}, before));
  return { before, after: current.get({ plain: true }) };
}

export async function deleteContact(uuid) {
  const contact = UUID_PATTERN.test(uuid) ? await Contact.findOne({ where: { uuid } }) : null;
  if (!contact) {
    throw new AccountingValidationError("Contact not found");
  }
  if (await Invoice.findOne({ where: { contact_id: contact.contact_id }, attributes: ["invoice_id"] })) {
    throw new AccountingValidationError(
      `${contact.name} has invoices or bills and cannot be deleted. Set it to inactive instead.`
    );
  }
  const plain = contact.get({ plain: true });
  await contact.destroy();
  return plain;
}
