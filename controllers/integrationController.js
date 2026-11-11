// Administration > ERP Integrations: API keys for the other systems that share data with accounting.
import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { diffFields, logAudit } from "../services/auditService.js";
import {
  createApiClient,
  getApiClient,
  listApiClients,
  rotateApiKey,
  SCOPES,
  updateApiClient
} from "../services/integrationService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

const scopeOptions = (selected) =>
  SCOPES.map((s) => ({ ...s, checked: s.value === "read" || selected.includes(s.value), locked: s.value === "read" }));

const apiBaseUrl = (req) => `${req.protocol}://${req.get("host")}${urls.apiV1}`;

export const integrationGrid = async (req, res) => {
  res.render("integrationGrid", {
    title: "ERP Integrations",
    activeMenu: "integrations",
    urls,
    clients: await listApiClients(),
    apiBaseUrl: apiBaseUrl(req)
  });
};

export const integrationNew = (req, res) => {
  res.render("integrationForm", {
    title: "New integration",
    activeMenu: "integrations",
    urls,
    client: null,
    scopes: scopeOptions([]),
    apiBaseUrl: apiBaseUrl(req),
    form: { method: "POST", action: urls.createIntegration }
  });
};

export const integrationEdit = async (req, res, next) => {
  const client = await getApiClient(req.params.id);
  if (!client) return next();
  res.render("integrationForm", {
    title: client.name,
    activeMenu: "integrations",
    urls,
    client,
    scopes: scopeOptions(client.scopes),
    apiBaseUrl: apiBaseUrl(req),
    form: { method: "PATCH", action: client.updateApi }
  });
};

export const createIntegration = async (req, res) => {
  try {
    const { client, apiKey } = await createApiClient(req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "integration.create",
      entityType: "api_client",
      entityId: client.uuid,
      summary: `Created integration ${client.name} (${client.systemCode}) with scopes ${client.scopes.join(", ")}`
    });
    // The only time the full key leaves the server; it is not stored in readable form.
    res.json({ data: { ...client, apiKey } });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateIntegration = async (req, res) => {
  try {
    const { before, after } = await updateApiClient(req.params.id, req.body);
    const changes = diffFields(
      { ...before, scopes: before.scopes.join(" ") },
      { ...after, scopes: after.scopes.join(" ") },
      ["name", "scopes", "status"]
    );
    if (Object.keys(changes).length > 0) {
      await logAudit(req, {
        action: "integration.update",
        entityType: "api_client",
        entityId: after.uuid,
        summary: `Updated integration ${after.name}: ${Object.keys(changes).join(", ")}`,
        details: changes
      });
    }
    res.json({ data: after });
  } catch (e) {
    sendError(res, e);
  }
};

export const rotateIntegrationKey = async (req, res) => {
  try {
    const { client, apiKey } = await rotateApiKey(req.params.id);
    await logAudit(req, {
      action: "integration.rotate_key",
      entityType: "api_client",
      entityId: client.uuid,
      summary: `Generated a new API key for integration ${client.name}; the previous key no longer works`
    });
    res.json({ data: { ...client, apiKey } });
  } catch (e) {
    sendError(res, e);
  }
};
