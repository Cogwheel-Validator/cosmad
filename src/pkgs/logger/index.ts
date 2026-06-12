import pino from "pino";
import pretty from "pino-pretty";

const stream = pretty({
    colorize: true,
});

const logger = pino(
    {
        name: "cosmad",
        level: process.env.NODE_ENV === "development" ? "debug" : "info",
    },
    stream,
);

export default logger;
