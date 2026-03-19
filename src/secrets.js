import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "bilingual-srt-openai";
const WINDOWS_ACCOUNT = "OpenAI API key";

function isMac() {
  return process.platform === "darwin";
}

function isWindows() {
  return process.platform === "win32";
}

function getWindowsSecretPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "bilingual-srt", "openai-api-key.txt");
}

async function promptSecret(promptText) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Cannot securely prompt for a key in a non-interactive terminal.");
  }

  const rl = readline.createInterface({
    input,
    output,
    terminal: true
  });

  try {
    rl._writeToOutput = (value) => {
      if (value.includes(promptText)) {
        output.write(value);
      }
    };
    const secret = await rl.question(promptText);
    output.write("\n");
    return secret.trim();
  } finally {
    rl.close();
  }
}

async function runPowerShell(script, args = []) {
  const command = Buffer.from(script, "utf16le").toString("base64");
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", command, ...args],
    { windowsHide: true }
  );
  return result.stdout.trim();
}

async function saveMacKey(apiKey) {
  try {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-a",
      SERVICE_NAME,
      "-s",
      SERVICE_NAME,
      "-w",
      apiKey
    ]);
  } catch (error) {
    throw new Error("Failed to save the API key to macOS Keychain.");
  }
}

async function readMacKey() {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      SERVICE_NAME,
      "-s",
      SERVICE_NAME,
      "-w"
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function deleteMacKey() {
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-a",
      SERVICE_NAME,
      "-s",
      SERVICE_NAME
    ]);
    return true;
  } catch {
    return false;
  }
}

async function saveWindowsKey(apiKey) {
  const secretPath = getWindowsSecretPath();
  await fs.mkdir(path.dirname(secretPath), { recursive: true });

  const script = `
param([string]$plainText,[string]$destination)
$secure = ConvertTo-SecureString -String $plainText -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -Path $destination -Value $encrypted -NoNewline
`;

  try {
    await runPowerShell(script, [apiKey, secretPath]);
  } catch {
    throw new Error("Failed to save the API key to the Windows protected store.");
  }
}

async function readWindowsKey() {
  const secretPath = getWindowsSecretPath();

  try {
    await fs.access(secretPath);
  } catch {
    return null;
  }

  const script = `
param([string]$source)
if (-not (Test-Path $source)) { exit 0 }
$encrypted = Get-Content -Path $source -Raw
if ([string]::IsNullOrWhiteSpace($encrypted)) { exit 0 }
$secure = ConvertTo-SecureString -String $encrypted
$credential = New-Object System.Management.Automation.PSCredential("${WINDOWS_ACCOUNT}", $secure)
[Console]::Out.Write($credential.GetNetworkCredential().Password)
`;

  try {
    const secret = await runPowerShell(script, [secretPath]);
    return secret || null;
  } catch {
    return null;
  }
}

async function deleteWindowsKey() {
  const secretPath = getWindowsSecretPath();
  try {
    await fs.unlink(secretPath);
    return true;
  } catch {
    return false;
  }
}

export async function saveApiKey(apiKey) {
  if (!apiKey?.trim()) {
    throw new Error("The API key cannot be empty.");
  }

  if (isMac()) {
    await saveMacKey(apiKey.trim());
    return;
  }

  if (isWindows()) {
    await saveWindowsKey(apiKey.trim());
    return;
  }

  throw new Error("Secure key storage is currently supported on macOS and Windows only.");
}

export async function readStoredApiKey() {
  if (isMac()) {
    return readMacKey();
  }

  if (isWindows()) {
    return readWindowsKey();
  }

  return null;
}

export async function removeStoredApiKey() {
  if (isMac()) {
    return deleteMacKey();
  }

  if (isWindows()) {
    return deleteWindowsKey();
  }

  return false;
}

export async function getApiKeyFromUser() {
  return promptSecret("Enter your OpenAI API key: ");
}

export function getStorageDescription() {
  if (isMac()) {
    return "macOS Keychain";
  }

  if (isWindows()) {
    return "Windows protected per-user store";
  }

  return "unsupported platform";
}
