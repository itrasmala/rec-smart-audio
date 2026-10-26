"use client";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";

export default function NotFound() {
  const { t } = usePrefs();
  return (
    <div className="py-24 text-center">
      <p className="text-lg font-semibold">{t("الصفحة غير موجودة", "Page not found")}</p>
      <Link href="/" className="mt-3 inline-block text-petrol underline">
        {t("العودة للرئيسية", "Back to overview")}
      </Link>
    </div>
  );
}
