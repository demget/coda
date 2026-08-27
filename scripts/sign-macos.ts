import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export function createSignOptions(
  options: SignOptions,
  updateRequirement = process.env.CODA_MACOS_UPDATE_REQUIREMENT?.trim(),
): SignOptions {
  if (!updateRequirement) {
    return { ...options, batchCodesignCalls: true };
  }

  const optionsForFile = options.optionsForFile;
  return {
    ...options,
    batchCodesignCalls: true,
    optionsForFile: (filePath, context) => {
      const fileOptions = optionsForFile?.(filePath, context) ?? {};
      return filePath === options.app
        ? { ...fileOptions, requirements: updateRequirement }
        : fileOptions;
    },
  };
}

/** Sign files with matching options together instead of spawning codesign for each file. */
export default async function sign(options: SignOptions): Promise<void> {
  await signApplication(createSignOptions(options));
}
