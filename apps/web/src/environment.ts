export function shouldEnableInternalSurfaces(input: { isDev: boolean; mode: string }): boolean {
  return input.isDev || input.mode === "test";
}

export function shouldEnableProductSurfaces(input: { isDev: boolean; mode: string }): boolean {
  return shouldEnableInternalSurfaces(input) || input.mode === "alpha";
}

export function shouldRequireAlphaAccess(input: { isDev: boolean; mode: string }): boolean {
  return !input.isDev && input.mode === "alpha";
}
