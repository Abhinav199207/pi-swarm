import pino from "pino";
import { loadConfig } from "../config.js";

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!logger) {
    const cfg = loadConfig();
    logger = pino({ level: cfg.logLevel, name: "pi-swarm" });
  }
  return logger;
}
