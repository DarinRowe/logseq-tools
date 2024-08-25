import fs from "fs/promises";
import path from "path";
import trash from "trash";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Read configuration file
const config = JSON.parse(await fs.readFile("config.json", "utf8"));

let deletedFiles = 0;

// Define log levels
const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

// Convert string log level to numeric value
function getLogLevelValue(level) {
  switch (level.toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warn":
      return LogLevel.WARN;
    case "error":
    default:
      return LogLevel.ERROR;
  }
}

// Set default log level from the configuration file
let currentLogLevel = getLogLevelValue(config.logLevel || "error");

// Logging function
function log(level, message) {
  if (level <= currentLogLevel) {
    const prefix = Object.keys(LogLevel)[level];
    console.log(`[${prefix}] ${message}`);
  }
}

async function isEmptyNote(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim() === "-";
}

async function processFile(filePath) {
  try {
    if (await isEmptyNote(filePath)) {
      await trash(filePath);
      log(LogLevel.DEBUG, `Deleted empty note: ${filePath}`);
      deletedFiles++;
    }
  } catch (error) {
    log(LogLevel.ERROR, `Error processing ${filePath}: ${error.message}`);
  }
}

async function processDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const lowerCaseName = entry.name.toLowerCase();
      if (lowerCaseName === "logseq" || lowerCaseName === ".trash") {
        log(LogLevel.DEBUG, `Skipping folder: ${fullPath}`);
        continue;
      }
      await processDirectory(fullPath);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      await processFile(fullPath);
    }
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("dir", {
      alias: "d",
      type: "string",
      description: "Directory to process",
      default: config.logseqPath,
    })
    .option("logLevel", {
      alias: "l",
      type: "string",
      description: "Log level (error, warn, info, debug)",
      default: config.logLevel,
    })
    .help().argv;

  // Set log level, prioritize command line argument, then use configuration file
  currentLogLevel = getLogLevelValue(argv.logLevel);

  log(LogLevel.INFO, "Starting empty note cleanup process...");
  log(LogLevel.INFO, `Processing directory: ${argv.dir}`);
  log(LogLevel.INFO, `Log level: ${argv.logLevel}`);

  try {
    await processDirectory(argv.dir);
    log(LogLevel.INFO, "Cleanup complete");
    log(LogLevel.INFO, `Deleted ${deletedFiles} empty note files`);
  } catch (error) {
    log(LogLevel.ERROR, `An error occurred: ${error}`);
  }
}

main();
