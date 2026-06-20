//#region src/headless-ui-context.ts
function createHeadlessUIContext() {
	const noop = () => {};
	return {
		select: async () => void 0,
		confirm: async () => false,
		input: async () => void 0,
		editor: async () => void 0,
		notify: noop,
		setStatus: noop,
		setWidget: noop,
		setTitle: noop,
		setEditorText: noop,
		getEditorText: () => "",
		onTerminalInput: () => () => {},
		setWorkingMessage: noop,
		setHiddenThinkingLabel: noop,
		setFooter: noop,
		setHeader: noop,
		custom: async () => void 0,
		pasteToEditor: noop,
		setEditorComponent: noop,
		theme: {},
		getAllThemes: () => [],
		getTheme: () => void 0,
		setTheme: () => ({
			success: false,
			error: "Not supported"
		}),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		addAutocompleteProvider: noop,
		getEditorComponent: () => void 0
	};
}
//#endregion
export { createHeadlessUIContext };
