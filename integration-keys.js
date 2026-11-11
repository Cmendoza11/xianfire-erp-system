// Issues the Accounting API keys the other DJ's ERP modules use (POS, HR, Procurement).
// Run by the root `npm run migrate`; safe to run again. A key that still authenticates is kept.
// A missing or stale key is rotated, never deleted and re-created, because external ids belong to
// the client row. With --json, stdout carries only {"ERP_API_KEY_X": "xfk_..."} for new keys.
import { sequelize, ApiClient } from "./models/index.js";
import { authenticateApiKey, createApiClient, rotateApiKey, updateApiClient } from "./services/integrationService.js";
import { logAudit } from "./services/auditService.js";

const SYSTEMS = [
  { env: "ERP_API_KEY_POS", code: "pos", name: "DJ's POS & Inventory", scopes: ["journal:write"] },
  { env: "ERP_API_KEY_HR", code: "hr", name: "DJ's HR & Payroll", scopes: ["journal:write"] },
  { env: "ERP_API_KEY_SCM", code: "scm", name: "DJ's Procurement", scopes: ["contacts:write", "purchases:write", "journal:write"] }
];

const asJson = process.argv.includes("--json");
const log = (message) => (asJson ? console.error : console.log)(message);
const actor = { user: { email: "system:migrate" } };
const issued = {};

try {
  for (const system of SYSTEMS) {
    const row = await ApiClient.findOne({ where: { system_code: system.code } });

    if (!row) {
      const { client, apiKey } = await createApiClient({ name: system.name, system_code: system.code, scopes: system.scopes }, null);
      await logAudit({}, { ...actor, action: "integration.create", entityType: "api_client", entityId: client.uuid,
        summary: `Created integration ${client.name} (${client.systemCode}) with scopes ${client.scopes.join(", ")}` });
      issued[system.env] = apiKey;
      log(`  + ${system.code}: new integration and key`);
      continue;
    }

    if (!row.status) {
      // An admin switched it off on purpose; leave it alone.
      log(`  ! ${system.code}: integration is inactive in ERP Administration -> ERP Integrations; key not changed`);
      continue;
    }

    const current = String(row.scopes || "").split(/\s+/).filter(Boolean);
    const missing = system.scopes.filter((s) => !current.includes(s));
    if (missing.length) {
      const { after } = await updateApiClient(row.uuid, { scopes: [...current, ...missing] });
      await logAudit({}, { ...actor, action: "integration.update", entityType: "api_client", entityId: after.uuid,
        summary: `Updated integration ${after.name}: scopes`, details: { addedScopes: missing } });
      log(`  ~ ${system.code}: added scopes ${missing.join(", ")}`);
    }

    const existingKey = process.env[system.env];
    const owner = existingKey ? await authenticateApiKey(existingKey) : null;
    if (owner?.systemCode === system.code) {
      log(`  = ${system.code}: key in .env is valid`);
      continue;
    }

    const { client, apiKey } = await rotateApiKey(row.uuid);
    await logAudit({}, { ...actor, action: "integration.rotate_key", entityType: "api_client", entityId: client.uuid,
      summary: `Generated a new API key for integration ${client.name}; the previous key no longer works` });
    issued[system.env] = apiKey;
    log(`  * ${system.code}: key rotated (the one in .env did not match this database)`);
  }

  if (asJson) process.stdout.write(JSON.stringify(issued));
  else if (Object.keys(issued).length) {
    log("\nNew keys (shown once). Put them in the ERP root .env:");
    for (const [env, key] of Object.entries(issued)) log(`${env}=${key}`);
  }
} catch (err) {
  console.error("❌ Could not issue integration keys:", err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close().catch(() => {});
}
