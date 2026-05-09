import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// const migrationWarningCodes = new Set([
//   "a11y_autofocus",
//   "a11y_click_events_have_key_events",
//   "a11y_no_noninteractive_element_interactions",
//   "a11y_no_noninteractive_element_to_interactive_role",
//   "a11y_no_static_element_interactions",
//   "css_unused_selector",
//   "element_invalid_self_closing_tag",
//   "unknown_code",
// ]);

export default {
  preprocess: vitePreprocess(),
  // compilerOptions: {
  //   warningFilter: warning => !migrationWarningCodes.has(warning.code),
  // },
};
