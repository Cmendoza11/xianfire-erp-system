import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Records one-time data migrations (e.g. seeding the chart of accounts) so `npm run migrate` stays re-runnable.
export const Migration = sequelize.define("Migration", {
  migration_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false, unique: true }
}, {
  tableName: "migration",
  underscored: true,
  updatedAt: false
});

export { sequelize };
