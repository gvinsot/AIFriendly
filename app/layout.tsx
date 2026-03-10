import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "AI Friendly — Vérifiez si votre site est lisible par l'IA",
  description:
    "Analysez n'importe quelle URL pour savoir si elle est optimisée pour les moteurs et assistants IA (ChatGPT, etc.). Score, recommandations et aperçu IA.",
  openGraph: {
    title: "AI Friendly — Vérifiez si votre site est lisible par l'IA",
    description:
      "Analysez n'importe quelle URL pour savoir si elle est optimisée pour les moteurs et assistants IA (ChatGPT, etc.). Score, recommandations et aperçu IA.",
    type: "website",
    url: "https://aifriendly.fr",
    siteName: "AI Friendly",
    locale: "fr_FR",
    images: [
      {
        url: "https://aifriendly.fr/og-image.png",
        width: 1200,
        height: 630,
        alt: "AI Friendly - Analysez la lisibilité IA de votre site",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Friendly — Vérifiez si votre site est lisible par l'IA",
    description:
      "Analysez n'importe quelle URL pour savoir si elle est optimisée pour les moteurs et assistants IA.",
    images: ["https://aifriendly.fr/og-image.png"],
  },
  alternates: {
    canonical: "https://aifriendly.fr",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`scroll-smooth ${cormorant.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased min-h-screen bg-luxe-bg text-luxe-fg">
        {children}
        
        {/* Matomo Analytics */}
        <Script id="matomo" strategy="afterInteractive">
          {`
            var _paq = window._paq = window._paq || [];
            _paq.push(["setDocumentTitle", document.domain + "/" + document.title]);
            _paq.push(["setCookieDomain", "*.aifriendly.fr"]);
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
