<script lang="ts">
  import Bug from "lucide-svelte/icons/bug";
  import Menu from "lucide-svelte/icons/menu";
  import Moon from "lucide-svelte/icons/moon";
  import Palette from "lucide-svelte/icons/palette";
  import PanelLeftClose from "lucide-svelte/icons/panel-left-close";
  import PanelLeftOpen from "lucide-svelte/icons/panel-left-open";
  import PanelRightClose from "lucide-svelte/icons/panel-right-close";
  import PanelRightOpen from "lucide-svelte/icons/panel-right-open";
  import Sun from "lucide-svelte/icons/sun";
  import type { ThemeMode } from "../themes";

  let {
    theme,
    nextThemeLabel,
    sessionTitle,
    workspaceName,
    showDebugToggle = false,
    debugMode = false,
    debugModeLabel = "",
    sidebarCollapsed = false,
    showOutlineToggle = false,
    outlineSidebarOpen = false,
    onToggleSidebar = () => {},
    onToggleSidebarCollapse = () => {},
    onToggleOutlineSidebar = () => {},
    onToggleTheme = () => {},
    onOpenThemeSettings = () => {},
    onToggleDebugMode = () => {},
  }: {
    theme: "dark" | "light";
    nextThemeLabel: ThemeMode;
    sessionTitle: string;
    workspaceName: string | null;
    showDebugToggle?: boolean;
    debugMode?: boolean;
    debugModeLabel?: string;
    sidebarCollapsed?: boolean;
    showOutlineToggle?: boolean;
    outlineSidebarOpen?: boolean;
    onToggleSidebar?: () => void;
    onToggleSidebarCollapse?: () => void;
    onToggleOutlineSidebar?: () => void;
    onToggleTheme?: () => void;
    onOpenThemeSettings?: () => void;
    onToggleDebugMode?: () => void;
  } = $props();
</script>

<header class="app-header">
  <div class="header-leading">
    <button
      class="hamburger"
      aria-label="Toggle sidebar"
      onclick={onToggleSidebar}
    >
      <Menu class="hamburger-icon" aria-hidden="true" size={18} />
    </button>
    <button
      class="sidebar-collapse"
      type="button"
      aria-label={sidebarCollapsed
        ? "Expand sessions sidebar"
        : "Collapse sessions sidebar"}
      title={sidebarCollapsed
        ? "Expand sessions sidebar"
        : "Collapse sessions sidebar"}
      onclick={onToggleSidebarCollapse}
    >
      {#if sidebarCollapsed}
        <PanelLeftOpen class="sidebar-collapse-icon" aria-hidden="true" size={16} />
      {:else}
        <PanelLeftClose class="sidebar-collapse-icon" aria-hidden="true" size={16} />
      {/if}
    </button>
    <div class="header-brand">
      {#if workspaceName}
        <p class="workspace-name">{workspaceName}</p>
      {/if}
      <h1 class="app-title">{sessionTitle}</h1>
    </div>
  </div>
  <div class="header-status">
    {#if showOutlineToggle}
      <button
        class="outline-toggle"
        type="button"
        aria-label={outlineSidebarOpen
          ? "Collapse right sidebar"
          : "Expand right sidebar"}
        title={outlineSidebarOpen
          ? "Collapse right sidebar"
          : "Expand right sidebar"}
        onclick={onToggleOutlineSidebar}
      >
        {#if outlineSidebarOpen}
          <PanelRightClose class="outline-toggle-icon" aria-hidden="true" size={16} />
        {:else}
          <PanelRightOpen class="outline-toggle-icon" aria-hidden="true" size={16} />
        {/if}
      </button>
    {/if}
    {#if showDebugToggle}
      <button
        class="debug-toggle"
        class:active={debugMode}
        type="button"
        aria-label={debugModeLabel}
        title={debugModeLabel}
        onclick={onToggleDebugMode}
      >
        <Bug class="debug-icon" aria-hidden="true" size={16} />
        <span class="debug-label">Debug</span>
      </button>
    {/if}
    <button
      class="appearance-toggle"
      type="button"
      aria-label="Open appearance settings"
      title="Open appearance settings"
      onclick={onOpenThemeSettings}
    >
      <Palette class="appearance-icon" aria-hidden="true" size={16} />
    </button>
    <button
      class="theme-toggle"
      type="button"
      aria-label={`Switch to ${nextThemeLabel} theme`}
      title={`Switch to ${nextThemeLabel} theme`}
      onclick={onToggleTheme}
    >
      {#if theme === "dark"}
        <Sun class="theme-icon" aria-hidden="true" size={16} />
      {:else}
        <Moon class="theme-icon" aria-hidden="true" size={16} />
      {/if}
    </button>
  </div>
</header>

<style>
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px 10px 8px;
    height: 44px;
    /*padding: 0 14px;*/
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
    z-index: 20;
  }

  .header-leading {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .hamburger {
    display: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .hamburger-icon {
    width: 16px;
    height: 16px;
  }

  .header-brand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .workspace-name,
  .app-title {
    margin: 0;
    max-width: min(100%, 48vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-name {
    font-size: 0.64rem;
    line-height: 1.05;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-subtle);
  }

  .app-title {
    font-size: 0.9rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .sidebar-collapse,
  .outline-toggle,
  .debug-toggle,
  .appearance-toggle,
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    width: 22px;
    flex: 0 0 22px;
    padding: 0 7px;
    border-radius: 6px;
    border: none;
    background: var(--panel);
    font-size: 0.68rem;
    color: var(--text-subtle);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      transform 0.15s ease;
  }

  .debug-toggle {
    padding-right: 9px;
  }

  .sidebar-collapse:hover,
  .outline-toggle:hover,
  .debug-toggle:hover,
  .appearance-toggle:hover,
  .theme-toggle:hover {
    background: var(--surface-hover);
    color: var(--text-muted);
    transform: translateY(-1px);
  }

  .sidebar-collapse:focus-visible,
  .outline-toggle:focus-visible,
  .debug-toggle:focus-visible,
  .appearance-toggle:focus-visible,
  .theme-toggle:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .debug-toggle.active {
    color: var(--text);
    background: var(--surface-active);
  }

  .sidebar-collapse {
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    flex: 0 0 22px;
  }

  .outline-toggle,
  .appearance-toggle,
  .theme-toggle {
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    flex: 0 0 22px;
  }

  .sidebar-collapse-icon,
  .outline-toggle-icon,
  .debug-icon,
  .appearance-icon,
  .theme-icon {
    width: 14px;
    height: 14px;
  }

  @media (max-width: 900px) {
    .hamburger {
      display: flex;
    }

    .sidebar-collapse {
      display: none;
    }

    .app-header {
      height: auto;
      padding: calc(env(safe-area-inset-top) + 7px) 11px 9px;
    }

    .header-status {
      gap: 4px;
    }

    .debug-label {
      display: none;
    }

    .debug-toggle {
      padding-right: 7px;
    }
  }

  @media (max-width: 640px) {
    .app-header {
      padding-inline: 9px;
      gap: 8px;
    }

    .header-leading {
      gap: 8px;
    }

    .workspace-name,
    .app-title {
      max-width: min(100%, 42vw);
    }

    .hamburger {
      width: 24px;
      height: 24px;
    }

    .outline-toggle,
    .appearance-toggle,
    .theme-toggle {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
    }

    .debug-toggle {
      height: 24px;
      padding: 0 7px;
      font-size: 0.66rem;
    }
  }
</style>
