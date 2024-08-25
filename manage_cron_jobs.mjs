import { execSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Get the current project directory
const SCRIPT_DIR = process.cwd();

// Read the configuration file
async function readConfig() {
  const configPath = path.join(SCRIPT_DIR, "config.json");
  const configData = await fs.readFile(configPath, "utf8");
  return JSON.parse(configData);
}

// Get the current crontab content
function getCurrentCrontab() {
  try {
    return execSync("crontab -l", { encoding: "utf8" });
  } catch (error) {
    return "";
  }
}

// Update or add a cron job
function updateCron(crontab, job) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(job.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fullCommand = `/usr/local/bin/node ${path.join(SCRIPT_DIR, job.command)} >> ${path.join(
    SCRIPT_DIR,
    "logs",
    `${job.name}.log`
  )} 2>&1`;
  const index = lines.findIndex((line) => jobRegex.test(line));

  if (index !== -1) {
    lines[index] = `${job.schedule} ${fullCommand}`;
    console.log(`Updated existing cron job: ${job.name}`);
  } else {
    lines.push(`${job.schedule} ${fullCommand}`);
    console.log(`Added new cron job: ${job.name}`);
  }

  return lines.join("\n");
}

// Delete a cron job
function deleteCron(crontab, job) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(job.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const filteredLines = lines.filter((line) => !jobRegex.test(line));

  if (filteredLines.length < lines.length) {
    console.log(`Deleted cron job: ${job.name}`);
  } else {
    console.log(`Cron job not found: ${job.name}`);
  }

  return filteredLines.join("\n");
}

// Apply the new crontab
async function applyCrontab(crontab) {
  const tempFile = path.join(os.tmpdir(), "temp_crontab");
  await fs.writeFile(tempFile, crontab);
  execSync(`crontab ${tempFile}`);
  await fs.unlink(tempFile);
}

// Display usage instructions
function showUsage() {
  console.log("Usage: node manage_cron_jobs.mjs [options]");
  console.log("Options:");
  console.log("  -a, --add     Add or update cron jobs");
  console.log("  -d, --delete  Delete cron jobs");
  console.log("  -h, --help    Show this help message");
}

// Ensure the log directory exists
async function ensureLogDirectory() {
  const logDir = path.join(SCRIPT_DIR, "logs");
  await fs.mkdir(logDir, { recursive: true });
}

async function main() {
  // Ensure the log directory exists
  await ensureLogDirectory();

  // Read the configuration
  const config = await readConfig();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const option = args[0];

  // Get the current crontab
  let crontab = getCurrentCrontab();

  // Process based on the provided option
  switch (option) {
    case "-a":
    case "--add":
      // Add or update cron jobs
      for (const job of config.cronJobs) {
        crontab = updateCron(crontab, job);
      }
      break;
    case "-d":
    case "--delete":
      // Delete cron jobs
      for (const job of config.cronJobs) {
        crontab = deleteCron(crontab, job);
      }
      break;
    case "-h":
    case "--help":
    case undefined:
      // Show usage instructions
      showUsage();
      return;
    default:
      // Handle invalid options
      console.error(`Invalid option: ${option}`);
      showUsage();
      process.exit(1);
  }

  // Apply the updated crontab
  await applyCrontab(crontab);
  console.log("Cron jobs have been updated successfully.");

  // Display the current crontab contents
  console.log("Current crontab contents:");
  console.log(getCurrentCrontab());
}

// Run the main function and handle any errors
main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
