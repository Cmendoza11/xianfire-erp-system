import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Maps another system's own id (its "external_id") to the record it created here. The unique key
// makes a retried request return the first result instead of posting the same entry twice.
// entity_uuid stays null while the first request is still being processed.
export const IntegrationReference = sequelize.define("IntegrationReference", {
  integration_reference_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  api_client_id: { type: DataTypes.INTEGER, allowNull: false },
  entity_type: { type: DataTypes.STRING(30), allowNull: false },
  external_id: { type: DataTypes.STRING(100), allowNull: false },
  entity_uuid: { type: DataTypes.UUID, defaultValue: null }
}, {
  tableName: "integration_reference",
  underscored: true,
  indexes: [
    { name: "UNQ_INTEGRATION_REFERENCE_EXTERNAL", unique: true, fields: ["api_client_id", "entity_type", "external_id"] },
    { name: "IDX_INTEGRATION_REFERENCE_ENTITY", fields: ["entity_type", "entity_uuid"] }
  ]
});

export { sequelize };
