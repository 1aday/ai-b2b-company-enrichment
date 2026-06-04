import "./globals.css";

export const metadata = {
  title: "Capital Signal Enrichment Console",
  description: "Live investor company enrichment progress and results",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
