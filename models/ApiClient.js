import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// One row per external ERP system (inventory, payroll, POS, ...) allowed to call /api/v1.
// Only a SHA-256 hash of the API key is stored; the key itself is shown once when generated.
export const ApiClient = sequelize.define("ApiClient", {
  api_client_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING(100), allowNull: false },
  // Short stable id of the calling system, e.g. "inventory"; shown as "api:inventory" in the audit log.
  system_code: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  // Public, non-secret part of the key used to find the row before comparing hashes.
  key_prefix: { type: DataTypes.STRING(16), allowNull: false, unique: true },
  key_hash: { type: DataTypes.STRING(64), allowNull: false },
  // Space-separated scopes, e.g. "read journal:write".
  scopes: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "read" },
  status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  last_used_at: { type: DataTypes.DATE, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "api_client",
  underscored: true
});

export { sequelize };
