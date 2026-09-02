import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import { PROVIDER_CLIENT_DEFINITION_BY_VALUE } from "./providerDriverMeta";

describe("provider driver metadata", () => {
  it("registers Kimi with its settings schema and early-access presentation", () => {
    const definition = PROVIDER_CLIENT_DEFINITION_BY_VALUE[ProviderDriverKind.make("kimi")];

    expect(definition?.label).toBe("Kimi");
    expect(definition?.badgeLabel).toBe("Early Access");
    expect(definition?.settingsSchema.fields).toHaveProperty("binaryPath");
    expect(definition?.icon).toBeTypeOf("function");
  });

  it("registers Antigravity with its settings schema and early-access presentation", () => {
    const definition = PROVIDER_CLIENT_DEFINITION_BY_VALUE[ProviderDriverKind.make("antigravity")];

    expect(definition?.label).toBe("Antigravity");
    expect(definition?.badgeLabel).toBe("Early Access");
    expect(definition?.settingsSchema.fields).toHaveProperty("binaryPath");
    expect(definition?.icon).toBeTypeOf("function");
  });
});
