import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { I18nProvider } from "@/lib/i18n/context";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "AI Friendly — Check if your site is AI-readable",
  description:
    "Analyze any URL to see if it's optimized for AI engines and assistants (ChatGPT, etc.). Score, recommendations and AI preview.",
  openGraph: {
    title: "AI Friendly — Check if your site is AI-readable",
    description:
      "Analyze any URL to see if it's optimized for AI engines and assistants (ChatGPT, etc.). Score, recommendations and AI preview.",
    type: "website",
    url: "https://aifriendly.eu",
    siteName: "AI Friendly",
    locale: "en_US",
    images: [
      {
        url: "https://aifriendly.eu/og-image.png",
        width: 1200,
        height: 630,
        alt: "AI Friendly - Analyze your site's AI readability",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Friendly — Check if your site is AI-readable",
    description:
      "Analyze any URL to see if it's optimized for AI engines and assistants.",
    images: ["https://aifriendly.eu/og-image.png"],
  },
  alternates: {
    canonical: "https://aifriendly.eu",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`scroll-smooth ${cormorant.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased min-h-screen bg-luxe-bg text-luxe-fg">
        <I18nProvider>
          {children}
        </I18nProvider>

        {/* Matomo Analytics */}
        <Script id="matomo" strategy="afterInteractive">
          {`
            var _paq = window._paq = window._paq || [];
            _paq.push(["setDocumentTitle", document.domain + "/" + document.title]);
            _paq.push(["setCookieDomain", "*.aifriendly.eu"]);
            _paq.push(['trackPageView']);
            _paq.push(['enableLinkTracking']);
            (function() {
              var u="https://stats.methodinfo.fr/";
              _paq.push(['setTrackerUrl', u+'matomo.php']);
              _paq.push(['setSiteId', '2']);
              var d=document, g=d.createElement('script'), s=d.getElementsByTagName('script')[0];
              g.async=true; g.src=u+'matomo.js'; s.parentNode.insertBefore(g,s);
            })();
          `}
        </Script>
        <noscript>
          <p>
            <img
              referrerPolicy="no-referrer-when-downgrade"
              src="https://stats.methodinfo.fr/matomo.php?idsite=2&amp;rec=1"
              style={{border: 0}}
              alt=""
            />
          </p>
        </noscript>
      </body>
    </html>
  );
}
