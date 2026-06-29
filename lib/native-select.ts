/**
 * Shared className for native <select> elements.
 * Keep native selects — e2e uses Playwright's selectOption which requires them.
 */
export const nativeSelectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
