import type { Metadata, Viewport } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: [
    {
      path: "../shared/ui/fonts/Manrope-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../shared/ui/fonts/Manrope-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Импульс",
  description: "Рабочее приложение Импульс",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08151c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={manrope.variable}>
      <body>
        <Script
          id="telegram-web-app-bridge"
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
