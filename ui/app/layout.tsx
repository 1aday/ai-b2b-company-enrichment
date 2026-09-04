import "./globals.css";

export const metadata = {
  title: "SignalForge — Evidence-backed B2B company enrichment",
  description: "Sample dashboard for evidence-backed company profiles, commercial signals, and optional ICP qualification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
