import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import trash from "trash";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Read configuration file
const config = JSON.parse(await fs.readFile("config.json", "utf8"));

const supportedImageFormats = [".jpg", ".jpeg", ".png", ".tiff", ".gif"];

let processedMdFiles = 0;
let processedImages = 0;

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

async function convertToWebP(filePath, options) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".webp") {
      log(LogLevel.DEBUG, `Skipping already WebP file: ${filePath}`);
      return filePath;
    }

    const webpPath = filePath.replace(/\.[^/.]+$/, ".webp");

    if (
      await fs
        .access(webpPath)
        .then(() => true)
        .catch(() => false)
    ) {
      log(LogLevel.DEBUG, `Skipping existing file: ${webpPath}`);
      return filePath;
    }

    await sharp(filePath, { failOnError: false })
      .webp({
        quality: config.imageCompression.quality,
        lossless: config.imageCompression.lossless,
      })
      .toFile(webpPath);
    log(LogLevel.DEBUG, `Converted: ${filePath} -> ${webpPath}`);

    processedImages++;

    if (options.keepOriginal) {
      log(LogLevel.DEBUG, `Kept original file: ${filePath}`);
    } else {
      await trash(filePath);
      log(LogLevel.DEBUG, `Moved to recycle bin: ${filePath}`);
    }

    return webpPath;
  } catch (error) {
    log(LogLevel.ERROR, `Error processing ${filePath}: ${error.message}`);
    log(LogLevel.WARN, `Skipping file: ${filePath}`);
    return filePath;
  }
}

async function processMarkdownFile(filePath, options) {
  let content = await fs.readFile(filePath, "utf8");
  const imgRegex = /!\[.*?\]\((.*?)\)/g;
  let match;
  const conversionPromises = [];

  while ((match = imgRegex.exec(content)) !== null) {
    const imgPath = match[1];
    const fullImgPath = path.resolve(path.dirname(filePath), imgPath);
    const ext = path.extname(fullImgPath).toLowerCase();

    if (ext === ".webp") {
      log(LogLevel.DEBUG, `Skipping already WebP image: ${fullImgPath}`);
      continue;
    }

    if (supportedImageFormats.includes(ext)) {
      conversionPromises.push(
        convertToWebP(fullImgPath, options).then((newPath) => {
          const relativePath = path.relative(path.dirname(filePath), newPath);
          content = content.replace(imgPath, relativePath);
        })
      );
    }
  }

  await Promise.all(conversionPromises);
  await fs.writeFile(filePath, content, "utf8");
  log(LogLevel.DEBUG, `Updated Markdown file: ${filePath}`);

  processedMdFiles++;
}

async function processDirectory(directory, options) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const processingPromises = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const lowerCaseName = entry.name.toLowerCase();
      if (lowerCaseName === "logseq" || lowerCaseName === ".trash") {
        log(LogLevel.DEBUG, `Skipping folder: ${fullPath}`);
        continue;
      }
      await processDirectory(fullPath, options);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
      processingPromises.push(processMarkdownFile(fullPath, options));
      if (processingPromises.length >= options.concurrency) {
        await Promise.all(processingPromises);
        processingPromises.length = 0;
      }
    }
  }

  if (processingPromises.length > 0) {
    await Promise.all(processingPromises);
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
    .option("keepOriginal", {
      alias: "k",
      type: "boolean",
      description: "Keep original files",
      default: config.webpConversion.keepOriginal,
    })
    .option("concurrency", {
      alias: "c",
      type: "number",
      description: "Number of concurrent conversions",
      default: config.webpConversion.concurrency,
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

  log(LogLevel.INFO, "Starting conversion process...");
  log(LogLevel.INFO, `Processing directory: ${argv.dir}`);
  log(LogLevel.INFO, `Keep original files: ${argv.keepOriginal}`);
  log(LogLevel.INFO, `Concurrency: ${argv.concurrency}`);
  log(LogLevel.INFO, `Log level: ${argv.logLevel}`);

  try {
    await processDirectory(argv.dir, argv);
    log(LogLevel.INFO, "Conversion complete");
    log(LogLevel.INFO, `Processed ${processedMdFiles} Markdown files`);
    log(LogLevel.INFO, `Converted ${processedImages} images to WebP format`);
  } catch (error) {
    log(LogLevel.ERROR, `An error occurred: ${error}`);
  }
}

main();
