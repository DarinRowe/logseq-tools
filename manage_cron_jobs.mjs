import { execSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

const SCRIPT_DIR = "/path/to/your/script/directory";

// 检查脚本目录是否存在
async function checkScriptDir() {
  try {
    await fs.access(SCRIPT_DIR);
  } catch (error) {
    console.error(`Error: Script directory does not exist: ${SCRIPT_DIR}`);
    process.exit(1);
  }
}

// 获取当前的crontab内容
function getCurrentCrontab() {
  try {
    return execSync("crontab -l", { encoding: "utf8" });
  } catch (error) {
    return "";
  }
}

// 更新cron任务
function updateCron(crontab, job, schedule, command) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const index = lines.findIndex((line) => jobRegex.test(line));

  if (index !== -1) {
    lines[index] = `${schedule} ${command}`;
    console.log(`Updated existing cron job: ${job}`);
  } else {
    lines.push(`${schedule} ${command}`);
    console.log(`Added new cron job: ${job}`);
  }

  return lines.join("\n");
}

// 删除cron任务
function deleteCron(crontab, job, command) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const filteredLines = lines.filter((line) => !jobRegex.test(line));

  if (filteredLines.length < lines.length) {
    console.log(`Deleted cron job: ${job}`);
  } else {
    console.log(`Cron job not found: ${job}`);
  }

  return filteredLines.join("\n");
}

// 应用新的crontab
async function applyCrontab(crontab) {
  const tempFile = path.join(os.tmpdir(), "temp_crontab");
  await fs.writeFile(tempFile, crontab);
  execSync(`crontab ${tempFile}`);
  await fs.unlink(tempFile);
}

// 显示使用说明
function showUsage() {
  console.log("Usage: node manage_cron_jobs.mjs [options]");
  console.log("Options:");
  console.log("  -a, --add     Add or update cron jobs");
  console.log("  -d, --delete  Delete cron jobs");
  console.log("  -h, --help    Show this help message");
}

async function main() {
  await checkScriptDir();

  const args = process.argv.slice(2);
  const option = args[0];

  let crontab = getCurrentCrontab();

  switch (option) {
    case "-a":
    case "--add":
      crontab = updateCron(
        crontab,
        "github-backup",
        "0 * * * *",
        `/usr/local/bin/node ${SCRIPT_DIR}/github-backup.mjs >> /tmp/logseq-backup.log 2>&1`
      );
      crontab = updateCron(
        crontab,
        "convert-webp",
        "0 2 * * *",
        `/usr/local/bin/node ${SCRIPT_DIR}/convert-webp.mjs >> /tmp/convert-webp.log 2>&1`
      );
      crontab = updateCron(
        crontab,
        "clean-empty-notes",
        "0 3 * * 0",
        `/usr/local/bin/node ${SCRIPT_DIR}/clean-empty-notes.mjs >> /tmp/clean-notes.log 2>&1`
      );
      break;
    case "-d":
    case "--delete":
      crontab = deleteCron(crontab, "github-backup", `/usr/local/bin/node ${SCRIPT_DIR}/github-backup.mjs`);
      crontab = deleteCron(crontab, "convert-webp", `/usr/local/bin/node ${SCRIPT_DIR}/convert-webp.mjs`);
      crontab = deleteCron(crontab, "clean-empty-notes", `/usr/local/bin/node ${SCRIPT_DIR}/clean-empty-notes.mjs`);
      break;
    case "-h":
    case "--help":
    case undefined:
      showUsage();
      return;
    default:
      console.error(`Invalid option: ${option}`);
      showUsage();
      process.exit(1);
  }

  await applyCrontab(crontab);
  console.log("Cron jobs have been updated successfully.");
  console.log("Current crontab contents:");
  console.log(getCurrentCrontab());
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
