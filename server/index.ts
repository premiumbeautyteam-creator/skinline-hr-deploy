import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startScheduler } from "./jobs/scheduler";
import { startProbationCron } from "./lib/probation_cron";
import { startReserveCron } from "./lib/reserve_cron";
import { startAlertsCron } from "./lib/alerts_cron";
import { startCompanyRatingCron } from "./lib/company_rating_cron";
import { startVideoPipelineCron } from "./lib/video_pipeline_cron";
import { startAvitoVacanciesCron } from "./lib/avito_vacancies_cron";
import { startHhCron } from "./lib/hh_cron";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      // Start integration background jobs after the server is listening.
      try {
        startScheduler();
      } catch (err) {
        console.error("[scheduler] failed to start:", err);
      }
      // Iter5 crons
      try { startProbationCron(); } catch (err) { console.error("[probation_cron] failed:", err); }
      try { startReserveCron(); } catch (err) { console.error("[reserve_cron] failed:", err); }
      try { startAlertsCron(); } catch (err) { console.error("[alerts_cron] failed:", err); }
      try { startCompanyRatingCron(); } catch (err) { console.error("[company_rating_cron] failed:", err); }
      try { startVideoPipelineCron(); } catch (err) { console.error("[video_pipeline_cron] failed:", err); }
      // Iter7: Avito vacancy import cron
      startAvitoVacanciesCron().catch((err) => console.error("[avito_vacancies_cron] failed:", err));
      // Iter8: hh.ru background jobs (sync, token refresh, maintenance, vacancy import)
      try { startHhCron(); } catch (err) { console.error("[hh_cron] failed:", err); }
    },
  );
})();
