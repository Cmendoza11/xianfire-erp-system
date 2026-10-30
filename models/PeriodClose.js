import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// One row per closed fiscal year. The latest fiscal_year_end is the lock date of the books.
export const PeriodClose = sequelize.define("PeriodClose", {
  accounting_period_close_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  fiscal_year_start: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
  fiscal_year_end: { type: DataTypes.DATEONLY, allowNull: false },
  // NULL when the year had no revenue or expense activity, so no closing entry was needed.
  journal_entry_id: { type: DataTypes.INTEGER, defaultValue: null },
  retained_earnings_account_id: { type: DataTypes.INTEGER, allowNull: false },
  closed_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "accounting_period_close",
  underscored: true,
  updatedAt: false
});

export { sequelize };
