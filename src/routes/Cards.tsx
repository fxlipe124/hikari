import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CardDialog } from "@/components/CardDialog";
import { useCards } from "@/lib/queries";
import type { Card as CardType } from "@/lib/ipc";
import { useFormatMoney } from "@/lib/utils";

export function Cards() {
  const { t } = useTranslation();
  const formatMoney = useFormatMoney();
  const { data: cards } = useCards();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CardType | null>(null);

  function newCard() {
    setEditing(null);
    setOpen(true);
  }
  function editCard(c: CardType) {
    setEditing(c);
    setOpen(true);
  }

  return (
    <div>
      <div className="flex items-end justify-between border-b border-border px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("route.cards.title")}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {t("route.cards.count", { count: cards?.length ?? 0 })}
          </p>
        </div>
        <Button size="sm" onClick={newCard}>
          <Plus className="h-3.5 w-3.5" />
          {t("common.new_card")}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 p-6">
        {(cards ?? []).map((card) => (
          <button
            key={card.id}
            onClick={() => editCard(card)}
            className="text-left"
          >
            <Card className="overflow-hidden hover:border-border-strong transition-colors cursor-pointer">
              <div
                className="h-16 border-b border-border"
                style={{ backgroundColor: card.color }}
              />
              <CardContent className="space-y-3 py-4">
                <div>
                  <div className="text-sm font-semibold">{card.name}</div>
                  {card.last4 && (
                    <div className="text-xs text-fg-subtle tabular">•••• {card.last4}</div>
                  )}
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-fg-subtle">{t("card.field.closing")}</span>
                    <span className="tabular font-medium whitespace-nowrap">
                      {t("card.day_format", { day: card.closingDay })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-fg-subtle">{t("card.field.due")}</span>
                    <span className="tabular font-medium whitespace-nowrap">
                      {t("card.day_format", { day: card.dueDay })}
                    </span>
                  </div>
                  {card.creditLimitCents !== null && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-fg-subtle">{t("card.field.limit")}</span>
                      <span className="tabular font-medium whitespace-nowrap">{formatMoney(card.creditLimitCents)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </button>
        ))}

        {(cards?.length ?? 0) === 0 && (
          <button
            onClick={newCard}
            className="col-span-3 flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border px-6 py-12 text-fg-subtle hover:border-border-strong hover:bg-surface-hover transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span className="text-sm">{t("common.register_first_card")}</span>
          </button>
        )}
      </div>

      <CardDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
