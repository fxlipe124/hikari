import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import ptBR from "../locales/pt-BR.json";
import { getStoredLocale } from "./config";
import { useCurrencyStore } from "@/hooks/useCurrencyStore";

export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "pt-BR": { translation: ptBR },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

getStoredLocale()
  .then((stored) => {
    if (stored && isSupportedLocale(stored) && stored !== i18n.language) {
      void i18n.changeLanguage(stored);
    }
  })
  .catch((e) => {
    console.warn("i18n: failed to load stored locale", e);
  });

useCurrencyStore
  .getState()
  .hydrate()
  .catch((e) => {
    console.warn("i18n: failed to hydrate currency", e);
  });

export default i18n;
