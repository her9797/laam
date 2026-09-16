import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "bar-laam",
  description: "laam QR menu mobile web",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
