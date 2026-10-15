/**
 * Utility for detecting image messages in Telegram updates across all supported formats.
 * 
 * Supported image formats:
 * - JPEG: .jpg, .jpeg, .jfif
 * - PNG: .png
 * - GIF: .gif
 * - WebP: .webp
 * - BMP: .bmp
 * - TIFF: .tiff, .tif
 * - SVG: .svg
 * - HEIC/HEIF: .heic, .heif
 * - AVIF: .avif
 * - ICO: .ico
 */

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
  '.ico',
] as const;

export const SUPPORTED_IMAGE_EXTENSIONS_SET = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS);

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|svg|heic|heif|avif|ico)$/i;

/**
 * Determines whether a document is an image based on Telegram mime_type metadata
 * OR file name extension (format-agnostic detection).
 */
export function isImageDocument(mimeType?: string | null, fileName?: string | null): boolean {
  if (mimeType) {
    const lowerMime = mimeType.toLowerCase().trim();
    if (lowerMime.startsWith('image/')) {
      return true;
    }
    if (
      lowerMime === 'application/x-photoshop' ||
      lowerMime === 'application/photoshop' ||
      lowerMime === 'application/illustrator'
    ) {
      return true;
    }
  }

  if (fileName) {
    if (IMAGE_EXTENSION_REGEX.test(fileName.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a Telegram message (or edited message) contains an image in ANY supported representation:
 * - Compressed photo array (photo)
 * - Animated GIFs & MP4 loop animations (animation)
 * - Image stickers & WebP stickers (sticker)
 * - Document images (document with image MIME or supported extension)
 */
export function isImageMessage(message: any): boolean {
  if (!message || typeof message !== 'object') return false;

  // 1. Telegram compressed photo array
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    return true;
  }

  // 2. Animated GIFs / video animations (Telegram 'animation')
  if (message.animation) {
    return true;
  }

  // 3. Telegram stickers (WebP / animated / video image stickers)
  if (message.sticker) {
    return true;
  }

  // 4. Telegram document (uncompressed / "Send as file" images)
  if (message.document) {
    const doc = message.document;
    if (isImageDocument(doc.mime_type, doc.file_name)) {
      return true;
    }
  }

  return false;
}
