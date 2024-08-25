import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

// Set default log level
let currentLogLevel = LogLevel.INFO;

// Function to log messages with timestamps and log levels
function log(level, message) {
  if (getLogLevelValue(level) <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

// Function to handle errors and exit the process
function handleError(message, error, exitCode = 1) {
  log("ERROR", message);
  if (error) console.error(error);
  process.exit(exitCode);
}

// Function to validate the configuration object
function validateConfig(config) {
  const requiredFields = ["logseqPath", "backupPath", "githubRepo"];
  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Missing required config field: ${field}`);
    }
  }
  log("INFO", "Configuration validated successfully");
}

// Read and validate the configuration file
let config;
try {
  config = JSON.parse(await fs.readFile("config.json", "utf8"));
  validateConfig(config);

  // Set log level from config
  if (config.logLevel) {
    currentLogLevel = getLogLevelValue(config.logLevel);
    log("INFO", `Log level set to ${config.logLevel.toUpperCase()}`);
  }

  log("INFO", "Configuration file read and validated");
} catch (error) {
  handleError("Error reading or validating config file:", error);
}

// Function to execute shell commands with timeout
async function runCommand(command, timeout = 30000) {
  try {
    log("DEBUG", `Executing command: ${command}`);
    const { stdout, stderr } = await execAsync(command, { timeout });
    if (stdout) log("DEBUG", `Command output: ${stdout.trim()}`);
    if (stderr) log("WARN", `Command stderr: ${stderr.trim()}`);
    return stdout.trim();
  } catch (error) {
    if (error.code === "ETIMEDOUT") {
      handleError(`Command timed out: ${command}`, error);
    } else {
      handleError(`Error executing command: ${command}`, error);
    }
  }
}

// Function to execute Git operations with retries
async function gitOperation(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      log("DEBUG", `Attempting Git operation: ${operation} (attempt ${i + 1}/${maxRetries})`);
      await runCommand(operation);
      log("INFO", `Git operation successful: ${operation}`);
      return;
    } catch (error) {
      log("WARN", `Git operation failed (attempt ${i + 1}/${maxRetries}): ${operation}`);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retrying
    }
  }
}

// Function to clear the directory while preserving specific files
async function clearDirectory(dir) {
  const preserveFiles = [".git", "README.md", ".gitignore"];
  const entries = await fs.readdir(dir);

  log("INFO", `Clearing directory: ${dir}`);
  for (const entry of entries) {
    if (preserveFiles.includes(entry)) {
      log("DEBUG", `Preserving file: ${entry}`);
      continue;
    }
    const fullPath = path.join(dir, entry);
    await fs.remove(fullPath);
    log("DEBUG", `Removed: ${fullPath}`);
  }

  log("INFO", `Cleared directory: ${dir} (preserved ${preserveFiles.join(", ")})`);
}

// Function to ensure .gitignore file exists with correct content
async function ensureGitignore(dir) {
  const gitignorePath = path.join(dir, ".gitignore");
  const gitignoreContent = ".trash\n.trash 2\n.Trash\n";

  try {
    if (await fs.pathExists(gitignorePath)) {
      log("DEBUG", "Updating existing .gitignore file");
      const currentContent = await fs.readFile(gitignorePath, "utf8");
      const updatedContent =
        Array.from(new Set([...currentContent.split("\n"), ...gitignoreContent.split("\n")]))
          .filter((line) => line.trim() !== "")
          .join("\n") + "\n";

      await fs.writeFile(gitignorePath, updatedContent);
      log("INFO", ".gitignore file updated");
    } else {
      log("DEBUG", "Creating new .gitignore file");
      await fs.writeFile(gitignorePath, gitignoreContent);
      log("INFO", ".gitignore file created");
    }
  } catch (error) {
    handleError("Error managing .gitignore file:", error);
  }
}

// Main function to perform backup and push to GitHub
async function backupAndPush() {
  const sourceDir = config.logseqPath;
  const backupDir = config.backupPath;
  const githubRepo = config.githubRepo;

  log("INFO", "Starting backup process");
  log("DEBUG", `Source directory: ${sourceDir}`);
  log("DEBUG", `Backup directory: ${backupDir}`);
  log("DEBUG", `GitHub repository: ${githubRepo}`);

  // Check if source directory exists
  if (!(await fs.pathExists(sourceDir))) {
    handleError(`Source directory does not exist: ${sourceDir}`);
  }

  // Ensure backup directory exists
  try {
    await fs.ensureDir(backupDir);
    log("INFO", `Backup directory ensured: ${backupDir}`);
  } catch (error) {
    handleError(`Error creating backup directory: ${backupDir}`, error);
  }

  // Clear backup directory (preserving specified files)
  try {
    await clearDirectory(backupDir);
  } catch (error) {
    handleError(`Error clearing backup directory: ${backupDir}`, error);
  }

  // Define copy options
  const copyOptions = {
    overwrite: true,
    filter: (src) => {
      const basename = path.basename(src);
      return basename !== ".git" && basename !== ".trash" && basename !== ".trash 2" && basename !== ".Trash";
    },
    dereference: true,
    concurrency: 100, // Limit concurrent operations
  };

  // Copy files from source to backup directory
  try {
    log("INFO", "Copying files from source to backup directory");
    await fs.copy(sourceDir, backupDir, copyOptions);
    log("INFO", "Files copied successfully");
  } catch (error) {
    handleError("Error copying files:", error);
  }

  // Ensure .gitignore file exists and contains correct content
  await ensureGitignore(backupDir);

  // Change to backup directory
  process.chdir(backupDir);
  log("DEBUG", `Changed working directory to: ${backupDir}`);

  // Check if it's already a Git repository
  const isGitRepo = await fs.pathExists(path.join(backupDir, ".git"));

  if (!isGitRepo) {
    log("INFO", "Initializing new Git repository");
    await gitOperation("git init");
    await gitOperation(`git remote add origin ${githubRepo}`);
  } else {
    log("INFO", "Updating existing Git repository");
    await gitOperation(`git remote set-url origin ${githubRepo}`);
    await gitOperation("git fetch origin");
    await gitOperation("git checkout main || git checkout -b main");
  }

  // Check if remote repository is accessible
  try {
    log("INFO", "Checking remote repository accessibility");
    await runCommand("git ls-remote --exit-code --heads origin main", 10000);
    log("INFO", "Remote repository is accessible");
  } catch (error) {
    handleError("Error accessing remote repository. Please check your GitHub credentials and repository URL.", error);
  }

  // Check for changes
  log("INFO", "Checking for changes");
  const status = await runCommand("git status --porcelain");

  if (status) {
    log("INFO", "Changes detected. Proceeding with commit and push.");
    await gitOperation("git add .");
    const date = new Date().toISOString();
    await gitOperation(`git commit -m "Backup: ${date}"`);
    try {
      log("INFO", "Pushing changes to remote repository");
      await gitOperation("git push -u origin main");
      log("INFO", "Backup and push completed successfully");
    } catch (error) {
      log("ERROR", "Error pushing to remote repository:");
      console.error(error);
      log("WARN", "Changes are committed locally. Please push manually when possible.");
    }
  } else {
    log("INFO", "No changes detected. Skipping commit and push.");
  }
}

// Cleanup function to be called on script exit
async function cleanup() {
  // Add any cleanup operations here
  log("INFO", "Cleanup completed");
}

// Set up event listeners for script exit and interruption
process.on("exit", cleanup);
process.on("SIGINT", () => {
  log("WARN", "Script interrupted");
  cleanup();
  process.exit(2);
});

// Run the main function
backupAndPush().catch((error) => handleError("Unhandled error in backupAndPush:", error));
