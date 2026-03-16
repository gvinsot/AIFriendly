import type { Dictionary, Locale } from "./types";
import en from "./dictionaries/en";
import fr from "./dictionaries/fr";
import es from "./dictionaries/es";
import de from "./dictionaries/de";

export type { Dictionary, Locale };
export { LOCALES, DEFAULT_LOCALE } from "./types";

const dictionaries: Record<Locale, Dictionary> = { en, fr, es, de };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] || dictionaries.fr;
}

/** Map html lang code to our locale */
export function detectLocale(acceptLanguage?: string): Locale {
  if (!acceptLanguage) return "fr";
  const langs = acceptLanguage.split(",").map((l) => l.split(";")[0].trim().toLowerCase());
  for (const lang of langs) {
    const code = lang.split("-")[0];
    if (code in dictionaries) return code as Locale;
  }
  return "fr";
}
