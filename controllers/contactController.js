import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { diffFields, logAudit } from "../services/auditService.js";
import {
  CONTACT_TYPES,
  createContact as createContactRecord,
  deleteContact as deleteContactRecord,
  getContact,
  listContacts,
  updateContact as updateContactRecord
} from "../services/contactService.js";
import { DOCUMENT_KINDS, listContactDocuments } from "../services/invoiceService.js";

const PAGE = {
  customer: { activeMenu: "customers", gridUrl: urls.customerGrid, newUrl: urls.customerNew },
  supplier: { activeMenu: "suppliers", gridUrl: urls.supplierGrid, newUrl: urls.supplierNew }
};

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const contactGrid = (type) => async (req, res) => {
  res.render("contactGrid", {
    title: CONTACT_TYPES[type].plural,
    activeMenu: PAGE[type].activeMenu,
    urls,
    type,
    typeInfo: CONTACT_TYPES[type],
    page: PAGE[type],
    contacts: await listContacts(type)
  });
};

const blankContact = { name: "", email: "", phone: "", address: "", tin: "", status: 1 };

export const contactNew = (type) => (req, res) => {
  res.render("contactForm", {
    title: `New ${CONTACT_TYPES[type].label.toLowerCase()}`,
    activeMenu: PAGE[type].activeMenu,
    urls,
    type,
    typeInfo: CONTACT_TYPES[type],
    page: PAGE[type],
    contact: null,
    values: blankContact,
    form: { method: "POST", action: urls.createContact }
  });
};

export const contactEdit = (type) => async (req, res, next) => {
  const contact = await getContact(req.params.id);
  if (!contact || contact.type !== type) return next();
  res.render("contactForm", {
    title: contact.name,
    activeMenu: PAGE[type].activeMenu,
    urls,
    type,
    typeInfo: CONTACT_TYPES[type],
    page: PAGE[type],
    contact,
    values: contact,
    documents: await listContactDocuments(contact.contactId),
    documentLabel: DOCUMENT_KINDS[CONTACT_TYPES[type].documentKind].plural,
    form: { method: "PATCH", action: urls.updateContact(contact.uuid) }
  });
};

export const createContact = async (req, res) => {
  try {
    const type = req.body?.type;
    const contact = await createContactRecord(type, req.body);
    await logAudit(req, {
      action: "contact.create",
      entityType: "contact",
      entityId: contact.uuid,
      summary: `Created ${type} ${contact.name}`
    });
    res.json({ data: { ...contact, gridUrl: PAGE[type].gridUrl } });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateContact = async (req, res) => {
  try {
    const { before, after } = await updateContactRecord(req.params.id, req.body);
    const changes = diffFields(before, after, ["name", "email", "phone", "address", "tin", "status"]);
    if (Object.keys(changes).length > 0) {
      await logAudit(req, {
        action: "contact.update",
        entityType: "contact",
        entityId: after.uuid,
        summary: `Updated ${after.type} ${after.name}: ${Object.keys(changes).join(", ")}`,
        details: changes
      });
    }
    res.json({ data: after });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteContact = async (req, res) => {
  try {
    const contact = await deleteContactRecord(req.params.id);
    await logAudit(req, {
      action: "contact.delete",
      entityType: "contact",
      entityId: contact.uuid,
      summary: `Deleted ${contact.type} ${contact.name}`
    });
    res.json({ data: contact });
  } catch (e) {
    sendError(res, e);
  }
};
