import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Append-only history of who did what. User id and email are copied, not linked, so the
// trail survives if an admin user is later removed.
export const AuditLog = sequelize.define("AuditLog", {
  audit_log_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  admin_user_id: { type: DataTypes.INTEGER, defaultValue: null },
  user_email: { type: DataTypes.STRING, defaultValue: null },
  action: { type: DataTypes.STRING(50), allowNull: false },
  entity_type: { type: DataTypes.STRING(30), defaultValue: null },
  entity_id: { type: DataTypes.STRING(36), defaultValue: null },
  summary: { type: DataTypes.TEXT, allowNull: false },
  details: { type: DataTypes.TEXT, defaultValue: null },
  ip_address: { type: DataTypes.STRING(45), defaultValue: null }
}, {
  tableName: "audit_log",
  underscored: true,
  updatedAt: false,
  indexes: [
    { name: "IDX_AUDIT_LOG_CREATED_AT", fields: ["created_at"] },
    { name: "IDX_AUDIT_LOG_ACTION", fields: ["action"] }
  ]
});

export { sequelize };
