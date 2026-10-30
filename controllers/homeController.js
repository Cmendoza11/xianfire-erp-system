import { urls } from "../routes/urls.js";

// This is an admin-only accounting system: the home page opens the dashboard.
export const homePage = (req, res) => {
  res.redirect(urls.dashboard);
};

export const notFoundPage = (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: { status: 404, message: "Not found" } });
  }
  res.status(404).render("notFound", { title: "Page not found", urls });
};
