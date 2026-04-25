import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/Select";
import { isSupportedLocale, SUPPORTED_LOCALES } from "@/lib/i18n";
import { setStoredLocale } from "@/lib/config";
import { toast } from "@/lib/toast";

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const current = isSupportedLocale(i18n.language) ? i18n.language : "en";

  return (
    <Select
      value={current}
      onChange={async (e) => {
        const next = e.target.value;
        if (!isSupportedLocale(next)) return;
        try {
          await i18n.changeLanguage(next);
          await setStoredLocale(next);
        } catch (err) {
          toast.fromError(err, t("error.fallback"));
        }
      }}
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {t(`language.${locale}`)}
        </option>
      ))}
    </Select>
  );
}
