export interface Crop {
  luma: Float32Array;
  width: number;
  height: number;
}

/** Luminance perceptuelle (Rec. 601) d'une image RVBA. */
export function luminanceOf(data: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let p = 0; p < out.length; p++) {
    const i = p * 4;
    out[p] =
      0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number);
  }
  return out;
}
