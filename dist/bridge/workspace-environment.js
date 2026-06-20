import * as fs from "node:fs";
import * as path from "node:path";
//#region src/workspace-environment.ts
const PYTHON_VENV_ACTIVATE_CANDIDATES = [
	".venv/bin/activate",
	"venv/bin/activate",
	"env/bin/activate",
	".venv/Scripts/activate",
	"venv/Scripts/activate",
	"env/Scripts/activate"
];
function fileExists(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}
function shellQuote(value) {
	return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}
function readTextFile(filePath) {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}
function findPythonVenvActivateScript(cwd) {
	for (const candidate of PYTHON_VENV_ACTIVATE_CANDIDATES) if (fileExists(path.join(cwd, candidate))) return candidate;
	return null;
}
function buildDirenvEnvironment(cwd) {
	if (!fileExists(path.join(cwd, ".envrc"))) return null;
	return {
		type: "direnv",
		label: "direnv",
		detail: ".envrc"
	};
}
function normalizePythonEnvLabel(value) {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return trimmed.replace(/^['"]|['"]$/g, "").trim() || null;
}
function readPythonVenvPrompt(cwd, activateScript) {
	const activateScriptPath = path.join(cwd, activateScript);
	const venvRoot = path.dirname(path.dirname(activateScriptPath));
	const pyvenvCfg = readTextFile(path.join(venvRoot, "pyvenv.cfg"));
	if (pyvenvCfg) {
		const prompt = normalizePythonEnvLabel(pyvenvCfg.match(/^prompt\s*=\s*(.+)$/m)?.[1]);
		if (prompt) return prompt;
	}
	const activateContents = readTextFile(activateScriptPath);
	if (!activateContents) return null;
	return normalizePythonEnvLabel(activateContents.match(/^VIRTUAL_ENV_PROMPT=(.+)$/m)?.[1]);
}
function buildPythonVenvEnvironment(cwd) {
	const activateScript = findPythonVenvActivateScript(cwd);
	if (!activateScript) return null;
	const rootDir = activateScript.split(/[\\/]/, 1)[0] || "venv";
	const configuredPrompt = readPythonVenvPrompt(cwd, activateScript);
	const fallbackWorkspaceName = path.basename(cwd);
	return {
		type: "python-venv",
		label: configuredPrompt && ![
			".venv",
			"venv",
			"env"
		].includes(configuredPrompt) ? configuredPrompt : [
			".venv",
			"venv",
			"env"
		].includes(rootDir) && fallbackWorkspaceName ? fallbackWorkspaceName : configuredPrompt || rootDir,
		detail: activateScript
	};
}
function detectWorkspaceEnvironments(cwd) {
	const normalizedCwd = cwd?.trim();
	if (!normalizedCwd) return;
	const environments = [buildDirenvEnvironment(normalizedCwd), buildPythonVenvEnvironment(normalizedCwd)].filter((environment) => Boolean(environment));
	return environments.length > 0 ? environments : void 0;
}
function buildWorkspaceActivationPrefix(cwd) {
	const normalizedCwd = cwd.trim();
	if (!normalizedCwd) return;
	const activationSteps = [];
	const environments = detectWorkspaceEnvironments(normalizedCwd) ?? [];
	for (const environment of environments) {
		if (environment.type === "direnv") {
			activationSteps.push([
				"if command -v direnv >/dev/null 2>&1; then",
				"  eval \"$(direnv export bash 2>/dev/null)\" || true",
				"fi"
			].join("\n"));
			continue;
		}
		if (environment.type === "python-venv" && environment.detail) {
			const quotedScriptPath = shellQuote(environment.detail);
			activationSteps.push([
				"if [ -z \"${VIRTUAL_ENV:-}\" ] && [ -f " + quotedScriptPath + " ]; then",
				"  . " + quotedScriptPath,
				"fi"
			].join("\n"));
		}
	}
	return activationSteps.length > 0 ? activationSteps.join("\n") : void 0;
}
//#endregion
export { buildWorkspaceActivationPrefix, detectWorkspaceEnvironments };
