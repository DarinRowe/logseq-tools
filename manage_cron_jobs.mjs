import { execSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

const SCRIPT_DIR = process.cwd();
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), "Library", "LaunchAgents");

async function readConfig() {
  const configPath = path.join(SCRIPT_DIR, "config.json");
  const configData = await fs.readFile(configPath, "utf8");
  return JSON.parse(configData);
}

function getNodePath() {
  try {
    return execSync("which node", { encoding: "utf8" }).trim();
  } catch (error) {
    console.error("获取 Node.js 路径时出错:", error);
    return "node";
  }
}

async function createPlistFile(job) {
  const nodePath = getNodePath();
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.${job.name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${path.resolve(SCRIPT_DIR, job.command)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>${job.schedule.minute}</integer>
        <key>Hour</key>
        <integer>${job.schedule.hour}</integer>
        <key>Day</key>
        <integer>${job.schedule.day}</integer>
        <key>Month</key>
        <integer>${job.schedule.month}</integer>
        <key>Weekday</key>
        <integer>${job.schedule.weekday}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${path.join(SCRIPT_DIR, "logs", `${job.name}.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(SCRIPT_DIR, "logs", `${job.name}_error.log`)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>`;

  const plistPath = path.join(LAUNCH_AGENTS_DIR, `com.user.${job.name}.plist`);
  await fs.writeFile(plistPath, plistContent);
  console.log(`创建了 plist 文件: ${plistPath}`);
}

async function removePlistFile(job) {
  const plistPath = path.join(LAUNCH_AGENTS_DIR, `com.user.${job.name}.plist`);
  try {
    await fs.unlink(plistPath);
    console.log(`删除了 plist 文件: ${plistPath}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`删除 plist 文件时出错: ${plistPath}`, error);
    } else {
      console.log(`plist 文件不存在: ${plistPath}`);
    }
  }
}

async function loadJob(job) {
  const plistPath = path.join(LAUNCH_AGENTS_DIR, `com.user.${job.name}.plist`);
  execSync(`launchctl load ${plistPath}`);
  console.log(`加载了作业: ${job.name}`);
}

async function unloadJob(job) {
  const plistPath = path.join(LAUNCH_AGENTS_DIR, `com.user.${job.name}.plist`);
  try {
    execSync(`launchctl unload ${plistPath}`);
    console.log(`卸载了作业: ${job.name}`);
  } catch (error) {
    console.log(`作业未加载或不存在: ${job.name}`);
  }
}

async function ensureLogDirectory() {
  const logDir = path.join(SCRIPT_DIR, "logs");
  await fs.mkdir(logDir, { recursive: true });
}

function showUsage() {
  console.log("用法: node manage_jobs.mjs [选项]");
  console.log("选项:");
  console.log("  -a, --add     添加或更新作业");
  console.log("  -d, --delete  删除作业");
  console.log("  -h, --help    显示此帮助信息");
}

async function main() {
  await ensureLogDirectory();
  const config = await readConfig();
  const args = process.argv.slice(2);
  const option = args[0];

  switch (option) {
    case "-a":
    case "--add":
      for (const job of config.jobs) {
        await createPlistFile(job);
        await loadJob(job);
      }
      break;
    case "-d":
    case "--delete":
      for (const job of config.jobs) {
        await unloadJob(job);
        await removePlistFile(job);
      }
      break;
    case "-h":
    case "--help":
    case undefined:
      showUsage();
      return;
    default:
      console.error(`无效选项: ${option}`);
      showUsage();
      process.exit(1);
  }

  console.log("作业管理操作完成。");
}

main().catch((error) => {
  console.error("发生错误:", error);
  process.exit(1);
});
