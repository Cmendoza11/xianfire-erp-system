import { authenticateApiKey } from "../services/integrationService.js";

const apiError = (res, status, message) => res.status(status).json({ error: { status, message } });

// Machine-to-machine auth for /api/v1: "Authorization: Bearer <key>" or "X-API-Key: <key>".
// Session cookies are ignored here, so a browser tab logged in to the admin cannot call /api/v1.
export const requireApiKey = async (req, res, next) => {
  try {
    const header = req.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : req.get("x-api-key");
    const client = await authenticateApiKey(key);
    if (!client) {
      res.set("WWW-Authenticate", 'Bearer realm="xianfires-erp"');
      return apiError(res, 401, "Missing or invalid API key");
    }
    req.apiClient = client;
    next();
  } catch (err) {
    next(err);
  }
};

export const hasScope = (req, scope) => Boolean(req.apiClient?.scopes.includes(scope));

export const requireScope = (scope) => (req, res, next) => {
  if (!hasScope(req, scope)) return apiError(res, 403, `This API key does not have the "${scope}" scope`);
  next();
};

// Only needed when another system's browser front end calls the API directly; server-to-server
// calls ignore CORS. Origins come from API_CORS_ORIGINS (comma-separated); none are allowed by default.
export const apiCors = (req, res, next) => {
  const allowed = (process.env.API_CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.get("origin");
  if (origin && allowed.includes(origin)) {
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    });
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
};
