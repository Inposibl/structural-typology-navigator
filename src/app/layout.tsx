import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Навигатор",
  description:
    "Автономный ИИ-навигатор Академии структурной типологии — помощь пользователям, подбор курсов, ответы на основе базы знаний и рекомендации по следующим шагам.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
