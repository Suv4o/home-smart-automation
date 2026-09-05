import { pino } from "pino";

/**
 * Pretty output when a human is watching, line-delimited JSON when piped to a
 * file or a service manager.
 */
export const logger = pino({
	level: process.env["LOG_LEVEL"] ?? "info",
	...(process.stdout.isTTY
		? {
				transport: {
					target: "pino-pretty",
					options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
				},
			}
		: {}),
});
