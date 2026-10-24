/**
 * Shrinks a photo before upload (max 1600 px, JPEG ~0.72) so receipts stay around 150-300 KB.
 * PDFs and small files are sent as they are.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.72): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 250_000) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob && blob.size < file.size ? blob : file;
}
