export type TemplateId = "classic" | "notebook" | "chalkboard";

/** Colors for the CSS-only mini preview on each card (mirrors laam-web's template palettes). */
export type TemplateSwatch = {
  background: string;
  text: string;
  accent: string;
  /** Ruled-paper line color (notebook). */
  lines?: string;
  /** Board frame color (chalkboard). */
  frame?: string;
  /** Index-tab colors (notebook). */
  tabs?: string[];
};

// Label/description values are keys in the `storeTemplate` namespace.
export const TEMPLATES: Array<{
  id: TemplateId;
  labelKey: string;
  descriptionKey: string;
  swatch: TemplateSwatch;
}> = [
  {
    id: "classic",
    labelKey: "classicLabel",
    descriptionKey: "classicDescription",
    swatch: { background: "#050505", text: "#fafafa", accent: "#8ce5c3" },
  },
  {
    id: "notebook",
    labelKey: "notebookLabel",
    descriptionKey: "notebookDescription",
    swatch: {
      background: "#FBF8EF",
      text: "#26324A",
      accent: "#B23A3A",
      lines: "#CFDCEA",
      tabs: ["#FFE36E", "#C9E8D2"],
    },
  },
  {
    id: "chalkboard",
    labelKey: "chalkboardLabel",
    descriptionKey: "chalkboardDescription",
    swatch: { background: "#222524", text: "#EDEBE4", accent: "#F2D675", frame: "#3C3F3D" },
  },
];

/**
 * The template the customer screen currently uses: a missing/empty value is
 * the server default (`classic`); an unrecognized value returns `null` so the
 * page can say so instead of guessing.
 */
export function resolveCurrentTemplate(value: string | undefined): TemplateId | null {
  if (!value) {
    return "classic";
  }
  return TEMPLATES.find((template) => template.id === value)?.id ?? null;
}
