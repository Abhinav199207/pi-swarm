import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/persistence/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://pi_swarm:pi_swarm@localhost:5432/pi_swarm",
  },
});
