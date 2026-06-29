import type { RpcImageContent } from "@pi-web/bridge/types";
import {
  createComposerAttachments,
  extractSupportedImageFiles,
  toRpcImageContent,
  type ComposerAttachment,
} from "./attachments";
import type { ImageContentBlock } from "./transcript";
import type { ComposerBarReactive } from "../components/composerBarState.svelte";

// ---------------------------------------------------------------------------
// Pure helpers — restore attachment metadata from RPC image payloads
// ---------------------------------------------------------------------------

function restoredAttachmentExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "img";
  }
}

function restoredAttachmentSize(base64Data: string): number {
  const n = base64Data.replace(/\s+/g, "");
  if (!n) return 0;
  const p = n.endsWith("==") ? 2 : n.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((n.length * 3) / 4) - p);
}

function restoredAttachmentId(index: number): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `restored_attachment_${Date.now().toString(36)}_${index.toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function attachmentsFromRpcImages(
  images: readonly RpcImageContent[] | undefined,
): ComposerAttachment[] {
  if (!images?.length) return [];
  return images.map((image, idx) => {
    const ext = restoredAttachmentExtension(image.mimeType);
    return {
      id: restoredAttachmentId(idx),
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
      name: `image-${idx + 1}.${ext}`,
      size: restoredAttachmentSize(image.data),
      previewUrl: `data:${image.mimeType};base64,${image.data}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Attachment slice — manages attachments, drag/drop, lightbox, notice
// ---------------------------------------------------------------------------

export interface AttachmentSlice {
  readonly attachments: ComposerAttachment[];
  readonly isDragActive: boolean;
  readonly attachmentNotice: string | null;
  readonly attachmentSummary: string;
  readonly lightboxAttachmentIndex: number;
  readonly lightboxImages: readonly ImageContentBlock[];
  readonly lightboxOpen: boolean;
  readonly hasAttachments: boolean;
  readonly toRpcImages: () => RpcImageContent[];

  clearAttachments(fileInputEl?: HTMLInputElement | null): void;
  restoreAttachments(list: readonly ComposerAttachment[]): void;
  addAttachmentsFromFiles(
    files: Iterable<File> | ArrayLike<File> | null | undefined,
  ): Promise<void>;
  removeAttachment(id: string): void;
  openAttachmentLightbox(index: number): void;
  closeAttachmentLightbox(): void;
  showPreviousAttachmentLightboxImage(): void;
  showNextAttachmentLightboxImage(): void;
  clearAttachmentNotice(): void;
  setAttachmentNotice(message: string | null): void;

  handleFilePickerOpen(fileInputEl?: HTMLInputElement | null): void;
  handleFileInputChange(
    event: Event,
    fileInputEl?: HTMLInputElement | null,
  ): Promise<void>;
  handleInputPaste(event: ClipboardEvent): Promise<void>;
  handleDragEnter(event: DragEvent): void;
  handleDragOver(event: DragEvent): void;
  handleDragLeave(event: DragEvent): void;
  handleDrop(event: DragEvent): Promise<void>;
}

export function createAttachmentSlice(
  $rx: ComposerBarReactive,
): AttachmentSlice {
  let attachments = $state<ComposerAttachment[]>([]);
  let isDragActive = $state(false);
  let dragDepth = 0;

  let attachmentNotice = $state<string | null>(null);
  let attachmentNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  let lightboxAttachmentIndex = $state(-1);

  let lightboxImages = $derived.by(() =>
    attachments.map<ImageContentBlock>(a => ({
      kind: "image",
      src: a.previewUrl,
      alt: a.name,
      mimeType: a.mimeType,
    })),
  );

  let lightboxOpen = $derived(
    lightboxAttachmentIndex >= 0 &&
      lightboxAttachmentIndex < attachments.length,
  );

  let hasAttachments = $derived(attachments.length > 0);
  let attachmentSummary = $derived(attachmentNotice ?? "");

  function clearAttachmentNotice() {
    if (attachmentNoticeTimer) {
      clearTimeout(attachmentNoticeTimer);
      attachmentNoticeTimer = null;
    }
    attachmentNotice = null;
  }

  function setAttachmentNotice(message: string | null) {
    clearAttachmentNotice();
    attachmentNotice = message;
    if (!message) return;
    attachmentNoticeTimer = setTimeout(() => {
      attachmentNotice = null;
      attachmentNoticeTimer = null;
    }, 4000);
  }

  function clearAttachments(fileInputEl?: HTMLInputElement | null) {
    attachments = [];
    lightboxAttachmentIndex = -1;
    if (fileInputEl) fileInputEl.value = "";
  }

  function restoreAttachments(list: readonly ComposerAttachment[]) {
    attachments = [...list];
    lightboxAttachmentIndex = -1;
  }

  async function addAttachmentsFromFiles(
    files: Iterable<File> | ArrayLike<File> | null | undefined,
  ) {
    if (!files) return;
    const incomingFiles = Array.from(files);
    if (!incomingFiles.length) return;
    const { attachments: nextAttachments, rejectedNames } =
      await createComposerAttachments(incomingFiles);
    if (nextAttachments.length > 0) {
      attachments = [...attachments, ...nextAttachments];
      setAttachmentNotice(null);
    }
    if (rejectedNames.length > 0) {
      setAttachmentNotice(
        `Skipped unsupported files: ${rejectedNames.join(", ")}`,
      );
    }
  }

  function removeAttachment(id: string) {
    const index = attachments.findIndex(a => a.id === id);
    if (index === -1) return;
    const nextAttachments = attachments.filter(a => a.id !== id);
    if (lightboxAttachmentIndex === index) {
      lightboxAttachmentIndex =
        nextAttachments.length > 0
          ? Math.min(index, nextAttachments.length - 1)
          : -1;
    } else if (lightboxAttachmentIndex > index) {
      lightboxAttachmentIndex -= 1;
    }
    attachments = nextAttachments;
    if (attachments.length === 0) clearAttachmentNotice();
  }

  function openAttachmentLightbox(index: number) {
    if (index < 0 || index >= attachments.length) return;
    lightboxAttachmentIndex = index;
  }

  function closeAttachmentLightbox() {
    lightboxAttachmentIndex = -1;
  }

  function showPreviousAttachmentLightboxImage() {
    if (attachments.length <= 1 || lightboxAttachmentIndex < 0) return;
    lightboxAttachmentIndex =
      (lightboxAttachmentIndex + attachments.length - 1) % attachments.length;
  }

  function showNextAttachmentLightboxImage() {
    if (attachments.length <= 1 || lightboxAttachmentIndex < 0) return;
    lightboxAttachmentIndex =
      (lightboxAttachmentIndex + 1) % attachments.length;
  }

  function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
    return Array.from(dataTransfer?.types ?? []).includes("Files");
  }

  function extractPastedFiles(event: ClipboardEvent): File[] {
    const directFiles = extractSupportedImageFiles(event.clipboardData?.files);
    if (directFiles.length > 0) return directFiles;
    const pastedFiles = Array.from(event.clipboardData?.items ?? [])
      .filter(i => i.kind === "file")
      .map(i => i.getAsFile())
      .filter((f): f is File => f !== null);
    return extractSupportedImageFiles(pastedFiles);
  }

  function handleFilePickerOpen(fileInputEl?: HTMLInputElement | null) {
    fileInputEl?.click();
  }

  async function handleFileInputChange(
    event: Event,
    fileInputEl?: HTMLInputElement | null,
  ) {
    const files = (event.target as HTMLInputElement | null)?.files;
    await addAttachmentsFromFiles(files);
    if (fileInputEl) fileInputEl.value = "";
  }

  async function handleInputPaste(event: ClipboardEvent) {
    const pastedFiles = extractPastedFiles(event);
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    await addAttachmentsFromFiles(pastedFiles);
  }

  function handleDragEnter(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    dragDepth += 1;
    isDragActive = true;
  }

  function handleDragOver(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    isDragActive = true;
  }

  function handleDragLeave(event: DragEvent) {
    if (!hasFilePayload(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isDragActive = false;
  }

  async function handleDrop(event: DragEvent) {
    dragDepth = 0;
    isDragActive = false;
    await addAttachmentsFromFiles(event.dataTransfer?.files);
  }

  function toRpcImages(): RpcImageContent[] {
    return toRpcImageContent(attachments);
  }

  return {
    get attachments() {
      return attachments;
    },
    get isDragActive() {
      return isDragActive;
    },
    get attachmentNotice() {
      return attachmentNotice;
    },
    get attachmentSummary() {
      return attachmentSummary;
    },
    get lightboxAttachmentIndex() {
      return lightboxAttachmentIndex;
    },
    get lightboxImages() {
      return lightboxImages;
    },
    get lightboxOpen() {
      return lightboxOpen;
    },
    get hasAttachments() {
      return hasAttachments;
    },
    toRpcImages,

    clearAttachments,
    restoreAttachments,
    addAttachmentsFromFiles,
    removeAttachment,
    openAttachmentLightbox,
    closeAttachmentLightbox,
    showPreviousAttachmentLightboxImage,
    showNextAttachmentLightboxImage,
    clearAttachmentNotice,
    setAttachmentNotice,

    handleFilePickerOpen,
    handleFileInputChange,
    handleInputPaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}