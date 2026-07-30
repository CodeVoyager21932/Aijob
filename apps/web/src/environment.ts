export function shouldEnableLocalSurfaces(input: { isDev: boolean; mode: string }): boolean {
  return input.isDev || input.mode === "test";
}
