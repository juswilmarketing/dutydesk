import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AppVariables } from "./env";
import { authMiddleware } from "./middleware/auth";
import authRoutes from "./routes/auth";
import tariffRoutes from "./routes/tariff";
import classifyRoutes from "./routes/classify";
import invoiceRoutes from "./routes/invoice";
import learnedRoutes from "./routes/learned";
import supplierHistoryRoutes from "./routes/supplier-history";
import exchangeRateRoutes from "./routes/exchange-rate";
import workflowRoutes from "./routes/workflow";
import emailRoutes from "./routes/email";
import usersRoutes from "./routes/users";
import flowboardRoutes from "./routes/flowboard";
import taxAdviceShareRoutes from "./routes/tax-advice-share";
import productIntelligenceRoutes from "./routes/product-intelligence";
import documentProcessingRoutes from "./routes/document-processing";
import productResolverRoutes from "./routes/product-resolver";
import classificationLineRoutes from "./routes/classification-lines";
import productResolutionRoutes from "./routes/product-resolution";
import supplierSearchRoutes from "./routes/supplier-search";
import { refreshTtbizlinkCacheBatch } from "./lib/ttbizlink";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, service: "dutydesk" }));

app.route("/api/integrations/flowboard", flowboardRoutes);
app.route("/api/flowboard", flowboardRoutes);

app.route("/api/auth", authRoutes);
app.route("/api/tax-advice/share", taxAdviceShareRoutes);

const protectedApi = new Hono<{ Bindings: Env; Variables: AppVariables }>();
protectedApi.use("*", authMiddleware);
protectedApi.route("/tariff", tariffRoutes);
protectedApi.route("/classify", classifyRoutes);
protectedApi.route("/invoice", invoiceRoutes);
protectedApi.route("/learned", learnedRoutes);
protectedApi.route("/supplier-history", supplierHistoryRoutes);
protectedApi.route("/exchange-rate", exchangeRateRoutes);
protectedApi.route("/workflow", workflowRoutes);
protectedApi.route("/email", emailRoutes);
protectedApi.route("/users", usersRoutes);
protectedApi.route("/product-intelligence", productIntelligenceRoutes);
protectedApi.route("/product-resolver", productResolverRoutes);
protectedApi.route("/classification-lines", classificationLineRoutes);
protectedApi.route("/product-resolution", productResolutionRoutes);
protectedApi.route("/supplier-search", supplierSearchRoutes);
protectedApi.route("/document-processing", documentProcessingRoutes);

app.route("/api", protectedApi);

app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

const handler: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(refreshTtbizlinkCacheBatch(env.DB, 100, "scheduled").then(() => undefined));
  },
};

export default handler;
