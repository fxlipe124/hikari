import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/Select";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  useCurrencyStore,
} from "@/hooks/useCurrencyStore";
import { toast } from "@/lib/toast";

export function CurrencyToggle() {
  const { t } = useTranslation();
  const currency = useCurrencyStore((s) => s.currency);
  const setCurrency = useCurrencyStore((s) => s.setCurrency);

  return (
    <Select
      value={currency}
      onChange={async (e) => {
        const next = e.target.value;
        if (!isSupportedCurrency(next)) return;
        try {
          await setCurrency(next);
        } catch (err) {
          toast.fromError(err, t("error.fallback"));
        }
      }}
    >
      {SUPPORTED_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {t(`currency.${code}`)}
        </option>
      ))}
    </Select>
  );
}
