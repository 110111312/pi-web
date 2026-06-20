import { buildWorkspaceActivationPrefix } from "./workspace-environment.js";
import { createAgentSessionFromServices, createAgentSessionServices, createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
//#region src/detached-session.ts
function buildDetachedShellCommandPrefix(cwd, basePrefix) {
	const prefixes = [buildWorkspaceActivationPrefix(cwd), basePrefix?.trim()].filter((value) => Boolean(value));
	return prefixes.length > 0 ? prefixes.join("\n") : void 0;
}
async function createDetachedAgentSession(cwd, sessionManager) {
	const services = await createAgentSessionServices({ cwd });
	const shellCommandPrefix = buildDetachedShellCommandPrefix(cwd, services.settingsManager.getShellCommandPrefix());
	return createAgentSessionFromServices({
		services,
		sessionManager,
		customTools: [
			createReadToolDefinition(cwd, { autoResizeImages: services.settingsManager.getImageAutoResize() }),
			createBashToolDefinition(cwd, { commandPrefix: shellCommandPrefix }),
			createEditToolDefinition(cwd),
			createWriteToolDefinition(cwd)
		]
	});
}
//#endregion
export { buildDetachedShellCommandPrefix, createDetachedAgentSession };
