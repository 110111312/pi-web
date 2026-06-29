<script lang="ts">
  import Pencil from "lucide-svelte/icons/pencil";
  import Trash2 from "lucide-svelte/icons/trash-2";
  import type { ContextMenuState } from "./sessionRailUtils";

  let {
    menu,
    onClose,
    onRename,
    onDelete,
  } = $props<{
    menu: ContextMenuState;
    onClose: () => void;
    onRename: (sessionPath: string) => void;
    onDelete: (sessionPath: string) => void;
  }>();

  const panelStyle = $derived(`left: ${menu.x}px; top: ${menu.y}px`);
</script>

<div
  class="menu-overlay"
  role="button"
  tabindex="0"
  onclick={onClose}
  onkeydown={(event) =>
    (event.key === "Enter" || event.key === " " || event.key === "Escape") &&
    onClose()}
  oncontextmenu={(event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }}
>
  <div
    class="menu-panel show"
    style={panelStyle}
    role="presentation"
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => event.stopPropagation()}
  >
    <button
      class="menu-item"
      type="button"
      onclick={() => menu.sessionPath && onRename(menu.sessionPath)}
    >
      <Pencil
        aria-hidden="true"
        size={13}
        style="opacity: 0.7; flex-shrink: 0"
      />
      <span>Rename</span>
    </button>
    <button
      class="menu-item danger"
      type="button"
      onclick={() => menu.sessionPath && onDelete(menu.sessionPath)}
    >
      <Trash2
        aria-hidden="true"
        size={13}
        style="opacity: 0.7; flex-shrink: 0"
      />
      <span>Delete</span>
    </button>
  </div>
</div>