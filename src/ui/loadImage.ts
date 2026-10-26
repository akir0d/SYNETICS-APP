/** Plus grand cote conserve pour l'image d'un plan. */
const MAX_IMAGE_SIDE = 1600;

/**
 * Reduit l'image importee : une capture de telephone pese plusieurs Mo, et
 * le plan est stocke en entier dans la carte pour rester partageable.
 */
export async function loadImage(file: File): Promise<{ image: string; aspect: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image illisible."));
      img.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible.');
    // Fond sombre : un plan PNG transparent deviendrait noir en JPEG.
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { image: canvas.toDataURL('image/jpeg', 0.85), aspect: w / h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
