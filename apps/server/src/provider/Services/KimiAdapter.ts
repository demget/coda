/**
 * KimiAdapter — shape type for the Kimi Code provider adapter.
 *
 * Like the other driver-bundled adapters, this is a naming anchor only: the
 * driver ({@link ../Drivers/KimiDriver}) captures one adapter per instance as
 * a closure rather than injecting it through the layer graph.
 *
 * @module KimiAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * KimiAdapterShape — per-instance Kimi adapter contract. Carries a branded
 * driver kind as the nominal discriminant.
 */
export interface KimiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
