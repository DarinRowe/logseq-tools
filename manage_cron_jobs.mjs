import { execSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

// 获取当前项目目录
const SCRIPT_DIR = process.cwd();

// 读取配置文件
async function readConfig() {
  const configPath = path.join(SCRIPT_DIR, "config.json");
  const configData = await fs.readFile(configPath, "utf8");
  return JSON.parse(configData);
}

// 获取当前 crontab 内容
function getCurrentCrontab() {
  try {
    return execSync("crontab -l", { encoding: "utf8" });
  } catch (error) {
    return "";
  }
}

// 检查是否安装了 NVM
function isNvmInstalled() {
  try {
    execSync("nvm --version", { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

// 获取 Node.js 可执行文件的路径
function getNodePath() {
  try {
    if (isNvmInstalled()) {
      // 使用 .nvmrc 中指定的 node 版本或默认版本
      const nodeVersion = execSync("nvm current", { encoding: "utf8" }).trim();
      return path.join(os.homedir(), ".nvm/versions/node", nodeVersion, "bin/node");
    } else {
      // 如果未使用 NVM，返回系统的 node 路径
      return execSync("which node", { encoding: "utf8" }).trim();
    }
  } catch (error) {
    console.error("获取 Node.js 路径时出错:", error);
    return "node"; // 如果出现任何问题，回退到直接使用 'node' 命令
  }
}

// 更新或添加 cron 作业
function updateCron(crontab, job) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(job.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nodePath = getNodePath();
  const fullCommand = `sh -c 'PATH=$PATH:/usr/local/bin:/usr/bin HOME=${os.homedir()} ${nodePath} ${path.resolve(
    SCRIPT_DIR,
    job.command
  )} >> ${path.join(SCRIPT_DIR, "logs", `${job.name}.log`)} 2>&1 || echo $? >> ${path.join(
    SCRIPT_DIR,
    "logs",
    `${job.name}_error.log`
  )}'`;
  const index = lines.findIndex((line) => jobRegex.test(line));

  if (index !== -1) {
    lines[index] = `${job.schedule} ${fullCommand}`;
    console.log(`更新了现有的 cron 作业: ${job.name}`);
  } else {
    lines.push(`${job.schedule} ${fullCommand}`);
    console.log(`添加了新的 cron 作业: ${job.name}`);
  }

  return lines.join("\n");
}

// 删除 cron 作业
function deleteCron(crontab, job) {
  const lines = crontab.split("\n");
  const jobRegex = new RegExp(job.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const filteredLines = lines.filter((line) => !jobRegex.test(line));

  if (filteredLines.length < lines.length) {
    console.log(`删除了 cron 作业: ${job.name}`);
  } else {
    console.log(`未找到 cron 作业: ${job.name}`);
  }

  return filteredLines.join("\n");
}

// 应用新的 crontab
async function applyCrontab(crontab) {
  const tempFile = path.join(os.tmpdir(), "temp_crontab");
  await fs.writeFile(tempFile, crontab);
  execSync(`crontab ${tempFile}`);
  await fs.unlink(tempFile);
}

// 显示使用说明
function showUsage() {
  console.log("用法: node manage_cron_jobs.mjs [选项]");
  console.log("选项:");
  console.log("  -a, --add     添加或更新 cron 作业");
  console.log("  -d, --delete  删除 cron 作业");
  console.log("  -h, --help    显示此帮助信息");
}

// 确保日志目录存在
async function ensureLogDirectory() {
  const logDir = path.join(SCRIPT_DIR, "logs");
  await fs.mkdir(logDir, { recursive: true });
}

// 检查并移除文件的扩展属性
async function removeExtendedAttributes(filePath) {
  try {
    await fs.access(filePath);
    execSync(`xattr -c "${filePath}"`);
    console.log(`已移除文件的扩展属性: ${filePath}`);
  } catch (error) {
    console.error(`无法移除文件的扩展属性: ${filePath}`, error);
  }
}

async function main() {
  // 确保日志目录存在
  await ensureLogDirectory();

  // 读取配置
  const config = await readConfig();

  // 解析命令行参数
  const args = process.argv.slice(2);
  const option = args[0];

  // 获取当前 crontab
  let crontab = getCurrentCrontab();

  // 根据提供的选项进行处理
  switch (option) {
    case "-a":
    case "--add":
      // 添加或更新 cron 作业
      for (const job of config.cronJobs) {
        crontab = updateCron(crontab, job);
        // 移除脚本文件的扩展属性
        await removeExtendedAttributes(path.resolve(SCRIPT_DIR, job.command));
      }
      break;
    case "-d":
    case "--delete":
      // 删除 cron 作业
      for (const job of config.cronJobs) {
        crontab = deleteCron(crontab, job);
      }
      break;
    case "-h":
    case "--help":
    case undefined:
      // 显示使用说明
      showUsage();
      return;
    default:
      // 处理无效选项
      console.error(`无效选项: ${option}`);
      showUsage();
      process.exit(1);
  }

  // 应用更新后的 crontab
  await applyCrontab(crontab);
  console.log("Cron 作业已成功更新。");

  // 显示当前 crontab 内容
  console.log("当前 crontab 内容:");
  console.log(getCurrentCrontab());
}

// 运行主函数并处理任何错误
main().catch((error) => {
  console.error("发生错误:", error);
  process.exit(1);
});
