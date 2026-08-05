export function shouldEnableInternalSurfaces(input: { isDev: boolean; mode: string }): boolean {
  return input.isDev || input.mode === "test";
}

export function shouldEnableProductSurfaces(input: { isDev: boolean; mode: string }): boolean {
  return shouldEnableInternalSurfaces(input) || input.mode === "alpha";
}

export function shouldRequireAlphaAccess(input: { isDev: boolean; mode: string }): boolean {
  return !input.isDev && input.mode === "alpha";
}

export function shouldEnableCareerOsV2(input: { flag: string | undefined }): boolean {
  const normalized = input.flag?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}
