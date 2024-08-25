import fs from "fs-extra";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// 读取配置文件
const config = JSON.parse(await fs.readFile("config.json", "utf8"));

async function runCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error);
    throw error;
  }
}

async function backupAndPush() {
  const sourceDir = config.logseqPath;
  const backupDir = config.backupPath;
  const githubRepo = config.githubRepo;

  // 确保源目录存在
  if (!(await fs.pathExists(sourceDir))) {
    console.error(`Source directory does not exist: ${sourceDir}`);
    return;
  }

  // 创建备份目录（如果不存在）
  await fs.ensureDir(backupDir);

  // 复制文件
  console.log(`Copying files from ${sourceDir} to ${backupDir}`);
  await fs.copy(sourceDir, backupDir, { overwrite: true });

  // 切换到备份目录
  process.chdir(backupDir);

  // 检查是否已经是一个 Git 仓库
  const isGitRepo = await fs.pathExists(path.join(backupDir, ".git"));

  if (!isGitRepo) {
    console.log("Initializing Git repository");
    await runCommand("git init");
    await runCommand(`git remote add origin ${githubRepo}`);
  }

  // 添加所有文件到 Git
  console.log("Adding files to Git");
  await runCommand("git add .");

  // 创建提交
  const date = new Date().toISOString();
  console.log("Creating commit");
  await runCommand(`git commit -m "Backup: ${date}"`);

  // 推送到 GitHub
  console.log("Pushing to GitHub");
  await runCommand("git push -u origin main");

  console.log("Backup and push completed successfully");
}

backupAndPush().catch(console.error);
