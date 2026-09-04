import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import sign, { createSignOptions } from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));

it("batches codesign calls without changing existing signing options", async () => {
  const options = {
    app: "/tmp/Coda.app",
    identity: "Developer ID Application: T3 Tools, Inc.",
    keychain: "/tmp/t3code.keychain",
    provisioningProfile: "/tmp/t3code.provisionprofile",
    optionsForFile: () => ({
      entitlements: "/tmp/t3code.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});

it("applies a stable update requirement only to the outer app bundle", () => {
  const options = {
    app: "/tmp/Coda (Nightly).app",
    identity: "-",
    optionsForFile: (filePath: string) => ({
      entitlements: filePath.endsWith("Helper.app")
        ? "/tmp/helper.entitlements.plist"
        : "/tmp/app.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;
  const requirement = '=designated => identifier "com.coda.app"';

  const configured = createSignOptions(options, requirement);

  expect(configured.optionsForFile?.(options.app, { platform: "darwin" })).toEqual({
    entitlements: "/tmp/app.entitlements.plist",
    hardenedRuntime: true,
    requirements: requirement,
  });
  expect(
    configured.optionsForFile?.("/tmp/Coda (Nightly).app/Contents/Frameworks/Coda Helper.app", {
      platform: "darwin",
    }),
  ).toEqual({
    entitlements: "/tmp/helper.entitlements.plist",
    hardenedRuntime: true,
  });
});
