import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge does not know the app's extra font-size tokens (`text-10`,
 * `text-11`, `text-13`, `text-15`, globals.css). Unregistered, it reads them as
 * text colours and drops them next to a colour class (`text-muted-foreground`),
 * so the text fell back to 16px.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["10", "11", "13", "15"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
