import "./globals.css";

export const metadata = {
  title: "Trend & Volatility Scanner",
  description: "Crypto + Forex trend continuation and volatility scanner.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
