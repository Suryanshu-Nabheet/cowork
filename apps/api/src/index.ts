import { loadRootEnv } from "./load-root-env.js";

loadRootEnv();

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const { app } = await createApp(env);
serve({ fetch: app.fetch, port: env.port }, () => {
  console.log(`cowork api on http://127.0.0.1:${env.port}`);
});
