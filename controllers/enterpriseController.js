import { urls } from "../routes/urls.js";
import { getEnterpriseOverview } from "../services/enterpriseService.js";
import { getAccountingSettings } from "../services/settingService.js";

// One page with the live figures of all 5 DJ's ERP modules, read from the shared database.
export const enterpriseOverviewPage = async (req, res) => {
  const settings = await getAccountingSettings();
  const overview = await getEnterpriseOverview();
  const link = Object.fromEntries((res.locals.erpModules ?? []).map((m) => [m.code, m.url]));
  res.render("enterpriseOverview", {
    title: "Enterprise Overview",
    activeMenu: "enterprise",
    urls,
    company: settings.companyName,
    currency: settings.currency,
    overview,
    link
  });
};
