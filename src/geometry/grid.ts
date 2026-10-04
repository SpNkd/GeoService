export function visualGridSteps(snapStep: number, pixelsPerUnit: number) {
  // Logarithms keep very small positive custom steps from underflowing in the density calculation.
  const exponent = Math.log10(snapStep);
  const factor = Math.max(0, Math.ceil(Math.log10(8) - exponent - Math.log10(pixelsPerUnit)));
  const minor = factor === 0 ? snapStep : 10 ** (exponent + factor);
  return { minor, major: minor * 5 };
}
