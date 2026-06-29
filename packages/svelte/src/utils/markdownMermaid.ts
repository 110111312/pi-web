import DOMPurify from "dompurify";
import type { RenderOptions } from "beautiful-mermaid";
import { readThemeMode } from "./codeHighlight";

export type MermaidRenderer = typeof import("beautiful-mermaid").renderMermaidSVG;

export const MERMAID_MIN_WIDTH = 420;
export const MERMAID_MAX_WIDTH = 900;
export const MERMAID_MIN_ZOOM = 0.5;
export const MERMAID_MAX_ZOOM = 2.5;
export const MERMAID_ZOOM_STEP = 0.25;

let mermaidPromise: Promise<MermaidRenderer> | null = null;

export function loadMermaid(): Promise<MermaidRenderer> {
  mermaidPromise ??= import("beautiful-mermaid").then(m => m.renderMermaidSVG);
  return mermaidPromise;
}

export function languageName(value?: string | null): string {
  for (const token of (value ?? "").split(/\s+/)) {
    if (token.startsWith("language-")) return token.slice("language-".length).toLowerCase();
  }
  return "";
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

export function getMermaidOptions(): RenderOptions {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const styles = getComputedStyle(shell ?? document.documentElement);
  const isDark = readThemeMode() !== "light";
  return {
    bg: cssVar(styles, "--panel", isDark ? "#161b22" : "#ffffff"),
    fg: cssVar(styles, "--text", isDark ? "#e6edf3" : "#1f2328"),
    line: cssVar(styles, "--text-subtle", isDark ? "#7d8590" : "#6e7781"),
    surface: cssVar(styles, "--panel-2", isDark ? "#21262d" : "#f6f8fa"),
    border: cssVar(styles, "--border-strong", isDark ? "#484f58" : "#afb8c1"),
    font: cssVar(styles, "--pi-font-sans", "system-ui, sans-serif"),
  };
}

export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["class", "style"],
  });
}

export function numericSvgLength(value: string | null): number | null {
  const match = value?.trim().match(/^[0-9.]+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function svgViewBoxWidth(svg: SVGSVGElement): number | null {
  const values = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = values?.[2];
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : null;
}

export function clampMermaidZoom(value: number): number {
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, value));
}

export function readMermaidZoom(block: HTMLElement): number {
  const zoom = Number(block.dataset.mermaidZoom);
  return Number.isFinite(zoom) ? clampMermaidZoom(zoom) : 1;
}

export function mermaidZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function updateMermaidZoom(block: HTMLElement, zoom: number) {
  const nextZoom = clampMermaidZoom(zoom);
  const baseWidth = Number(block.dataset.mermaidBaseWidth);
  const svg = block.querySelector<SVGSVGElement>("svg");
  block.dataset.mermaidZoom = String(nextZoom);
  if (svg && Number.isFinite(baseWidth) && baseWidth > 0) {
    svg.style.width = `${Math.round(baseWidth * nextZoom)}px`;
    svg.style.maxWidth = nextZoom > 1 ? "none" : "100%";
  }
  const label = block.querySelector<HTMLElement>("[data-mermaid-zoom-label]");
  if (label) label.textContent = mermaidZoomLabel(nextZoom);
  const zoomOut = block.querySelector<HTMLButtonElement>('[data-mermaid-zoom-action="out"]');
  const zoomIn = block.querySelector<HTMLButtonElement>('[data-mermaid-zoom-action="in"]');
  const reset = block.querySelector<HTMLButtonElement>('[data-mermaid-zoom-action="reset"]');
  if (zoomOut) zoomOut.disabled = nextZoom <= MERMAID_MIN_ZOOM;
  if (zoomIn) zoomIn.disabled = nextZoom >= MERMAID_MAX_ZOOM;
  if (reset) reset.disabled = nextZoom === 1;
}

function mermaidZoomButton(action: string, label: string, title: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-zoom-button";
  button.dataset.mermaidZoomAction = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  return button;
}

export function addMermaidZoomControls(block: HTMLElement) {
  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-block-toolbar";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "mermaid-zoom-label";
  zoomLabel.dataset.mermaidZoomLabel = "true";
  toolbar.append(
    mermaidZoomButton("out", "-", "Zoom out"),
    zoomLabel,
    mermaidZoomButton("in", "+", "Zoom in"),
    mermaidZoomButton("reset", "Reset zoom", "Reset zoom"),
  );
  toolbar.addEventListener("click", event => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-mermaid-zoom-action]")
      : null;
    if (!target) return;
    const currentZoom = readMermaidZoom(block);
    if (target.dataset.mermaidZoomAction === "out") {
      updateMermaidZoom(block, currentZoom - MERMAID_ZOOM_STEP);
    } else if (target.dataset.mermaidZoomAction === "in") {
      updateMermaidZoom(block, currentZoom + MERMAID_ZOOM_STEP);
    } else {
      updateMermaidZoom(block, 1);
    }
  });
  block.prepend(toolbar);
  updateMermaidZoom(block, readMermaidZoom(block));
}

export function wrapMermaidDiagram(block: HTMLElement) {
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "mermaid-diagram-scroll";
  scrollContainer.append(...block.childNodes);
  block.replaceChildren(scrollContainer);
}

export function fitMermaidSvg(block: HTMLElement) {
  const svg = block.querySelector<SVGSVGElement>("svg");
  const intrinsicWidth = svg
    ? (svgViewBoxWidth(svg) ?? numericSvgLength(svg.getAttribute("width")))
    : null;
  if (!intrinsicWidth) return;
  const displayWidth = Math.min(MERMAID_MAX_WIDTH, Math.max(MERMAID_MIN_WIDTH, intrinsicWidth));
  block.dataset.mermaidBaseWidth = String(displayWidth);
  updateMermaidZoom(block, readMermaidZoom(block));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceWithMermaidSource(block: HTMLElement, source: string, statusText: string) {
  const currentStatus = block.querySelector<HTMLElement>(".mermaid-block-status")?.textContent ?? "";
  const currentSource = block.querySelector<HTMLElement>(".mermaid-source code")?.textContent ?? "";
  if (currentStatus === statusText && currentSource === source) return;

  const status = document.createElement("div");
  status.className = "mermaid-block-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = statusText;
  const code = document.createElement("code");
  code.textContent = source;
  const pre = document.createElement("pre");
  pre.className = "mermaid-source";
  pre.append(code);
  delete block.dataset.mermaidBaseWidth;
  delete block.dataset.mermaidZoom;
  delete block.dataset.mermaidRendered;
  delete block.dataset.mermaidThemeMode;
  block.classList.remove("mermaid-block-rendered");
  block.replaceChildren(status, pre);
}

function showMermaidDeferred(block: HTMLElement) {
  const source = block.dataset.mermaidSource ?? "";
  replaceWithMermaidSource(block, source, "Waiting for complete Mermaid diagram...");
  block.classList.remove("mermaid-block-error", "mermaid-block-rendered");
}

function showMermaidError(block: HTMLElement, source: string, error: unknown) {
  block.classList.add("mermaid-block-error");
  replaceWithMermaidSource(block, source, `Could not render Mermaid diagram: ${errorText(error)}`);
}

export function replaceMermaidCodeBlocks(root: HTMLElement) {
  const codeBlocks = root.querySelectorAll<HTMLElement>("pre > code");
  for (const code of codeBlocks) {
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) continue;
    if (pre.closest(".mermaid-block")) continue;
    if (languageName(code.className) !== "mermaid") continue;
    const source = code.textContent ?? "";
    const block = document.createElement("div");
    block.className = "mermaid-block";
    block.dataset.mermaidSource = source;
    replaceWithMermaidSource(block, source, "Rendering diagram...");
    pre.replaceWith(block);
  }
}

export async function renderMermaidBlocks(
  root: HTMLElement,
  options: {
    renderVersion: { value: number };
    incrementRenderVersion: () => number;
    deferErrors: boolean;
    force: boolean;
  },
) {
  const version = options.incrementRenderVersion();
  await Promise.resolve();

  replaceMermaidCodeBlocks(root);

  const blocks = root.querySelectorAll<HTMLElement>(".mermaid-block[data-mermaid-source]");
  if (blocks.length === 0) return;

  if (options.deferErrors) {
    for (const block of blocks) showMermaidDeferred(block);
    return;
  }

  const renderMermaid = await loadMermaid();
  if (version !== options.renderVersion.value) return;

  const themeMode = readThemeMode();
  const renderOptions = getMermaidOptions();
  let index = 0;
  for (const block of blocks) {
    const source = block.dataset.mermaidSource ?? "";
    if (!source) {
      index += 1;
      continue;
    }
    if (!options.force && block.dataset.mermaidRendered === "true" && block.dataset.mermaidThemeMode === themeMode) {
      index += 1;
      continue;
    }
    try {
      const svg = renderMermaid(source, renderOptions);
      if (version !== options.renderVersion.value) return;
      block.innerHTML = sanitizeMermaidSvg(svg);
      wrapMermaidDiagram(block);
      fitMermaidSvg(block);
      addMermaidZoomControls(block);
      block.dataset.mermaidRendered = "true";
      block.dataset.mermaidThemeMode = themeMode;
      block.classList.add("mermaid-block-rendered");
      block.classList.remove("mermaid-block-error");
    } catch (error) {
      if (version !== options.renderVersion.value) return;
      showMermaidError(block, source, error);
    }
    index += 1;
  }
}