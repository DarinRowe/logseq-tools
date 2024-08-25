import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Function to log messages with timestamps
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Function to handle errors and exit the process
function handleError(message, error, exitCode = 1) {
  log(`ERROR: ${message}`);
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
}

// Read and validate the configuration file
let config;
try {
  config = JSON.parse(await fs.readFile("config.json", "utf8"));
  validateConfig(config);
} catch (error) {
  handleError("Error reading or validating config file:", error);
}

// Function to execute shell commands with timeout
async function runCommand(command, timeout = 30000) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout });
    if (stdout) log(stdout);
    if (stderr) log(`STDERR: ${stderr}`);
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
      await runCommand(operation);
      return;
    } catch (error) {
      log(`Git operation failed (attempt ${i + 1}/${maxRetries}): ${operation}`);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retrying
    }
  }
}

// Function to clear the directory while preserving specific files
async function clearDirectory(dir) {
  const preserveFiles = [".git", "README.md", ".gitignore"];
  const entries = await fs.readdir(dir);

  for (const entry of entries) {
    if (preserveFiles.includes(entry)) continue; // Preserve specified files
    const fullPath = path.join(dir, entry);
    await fs.remove(fullPath);
  }

  log(`Cleared directory: ${dir} (preserved ${preserveFiles.join(", ")})`);
}

// Function to ensure .gitignore file exists with correct content
async function ensureGitignore(dir) {
  const gitignorePath = path.join(dir, ".gitignore");
  const gitignoreContent = ".trash\n.trash 2\n.Trash\n";

  try {
    if (await fs.pathExists(gitignorePath)) {
      // If .gitignore exists, ensure it contains the required content
      const currentContent = await fs.readFile(gitignorePath, "utf8");
      const updatedContent =
        Array.from(new Set([...currentContent.split("\n"), ...gitignoreContent.split("\n")]))
          .filter((line) => line.trim() !== "")
          .join("\n") + "\n";

      await fs.writeFile(gitignorePath, updatedContent);
      log(".gitignore file updated");
    } else {
      // If .gitignore doesn't exist, create it
      await fs.writeFile(gitignorePath, gitignoreContent);
      log(".gitignore file created");
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

  // Check if source directory exists
  if (!(await fs.pathExists(sourceDir))) {
    handleError(`Source directory does not exist: ${sourceDir}`);
  }

  // Ensure backup directory exists
  try {
    await fs.ensureDir(backupDir);
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
    await fs.copy(sourceDir, backupDir, copyOptions);
    log("Files copied successfully");
  } catch (error) {
    handleError("Error copying files:", error);
  }

  // Ensure .gitignore file exists and contains correct content
  await ensureGitignore(backupDir);

  // Change to backup directory
  process.chdir(backupDir);

  // Check if it's already a Git repository
  const isGitRepo = await fs.pathExists(path.join(backupDir, ".git"));

  if (!isGitRepo) {
    log("Initializing Git repository");
    await gitOperation("git init");
    await gitOperation(`git remote add origin ${githubRepo}`);
  } else {
    log("Updating existing Git repository");
    await gitOperation(`git remote set-url origin ${githubRepo}`);
    await gitOperation("git fetch origin");
    await gitOperation("git checkout main || git checkout -b main");
  }

  // Check if remote repository is accessible
  try {
    await runCommand("git ls-remote --exit-code --heads origin main", 10000);
  } catch (error) {
    handleError("Error accessing remote repository. Please check your GitHub credentials and repository URL.", error);
  }

  // Check for changes
  const status = await runCommand("git status --porcelain");

  if (status) {
    log("Changes detected. Proceeding with commit and push.");
    await gitOperation("git add .");
    const date = new Date().toISOString();
    await gitOperation(`git commit -m "Backup: ${date}"`);
    try {
      await gitOperation("git push -u origin main");
      log("Backup and push completed successfully");
    } catch (error) {
      log("Error pushing to remote repository:");
      console.error(error);
      log("Changes are committed locally. Please push manually when possible.");
    }
  } else {
    log("No changes detected. Skipping commit and push.");
  }
}

// Cleanup function to be called on script exit
async function cleanup() {
  // Add any cleanup operations here
  log("Cleanup completed");
}

// Set up event listeners for script exit and interruption
process.on("exit", cleanup);
process.on("SIGINT", () => {
  log("Script interrupted");
  cleanup();
  process.exit(2);
});

// Run the main function
backupAndPush().catch((error) => handleError("Unhandled error in backupAndPush:", error));
