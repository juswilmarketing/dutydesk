import type { ProductFamilyPlugin, PluginMatch } from "./types";
import { automotivePlugin } from "./automotive";
import { electricalPlugin } from "./electrical";
import { packagingPlugin } from "./packaging";
import { medicalInstrumentsPlugin } from "./medical-instruments";
import { printerPlugin } from "./printers";
import {
  chemicalsPlugin,
  cosmeticsPlugin,
  foodPlugin,
  footwearPlugin,
  furniturePlugin,
  machineryPlugin,
  medicalPlugin,
  metalArticlesPlugin,
  plasticsPlugin,
  textilesPlugin,
} from "./keyword-plugins";

/** Ordered by specificity — first match wins. */
export const PRODUCT_FAMILY_PLUGINS: ProductFamilyPlugin[] = [
  packagingPlugin,
  medicalInstrumentsPlugin,
  printerPlugin,
  automotivePlugin,
  electricalPlugin,
  footwearPlugin,
  furniturePlugin,
  medicalPlugin,
  cosmeticsPlugin,
  foodPlugin,
  chemicalsPlugin,
  textilesPlugin,
  metalArticlesPlugin,
  plasticsPlugin,
  machineryPlugin,
];

export function matchProductFamilyPlugin(
  rawDescription: string,
  context?: { supplier?: string | null },
): PluginMatch | null {
  for (const plugin of PRODUCT_FAMILY_PLUGINS) {
    const hit = plugin.match(rawDescription, context);
    if (hit) return hit;
  }
  return null;
}

export function getPluginById(id: string): ProductFamilyPlugin | undefined {
  return PRODUCT_FAMILY_PLUGINS.find((p) => p.id === id);
}

export type { ProductFamilyPlugin, PluginMatch } from "./types";
