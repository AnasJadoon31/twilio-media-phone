import type { Metadata } from "next";
import { SessionProvider } from "@/components/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twilio Media Phone",
  description: "Twilio media stream test phone",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`antialiased`}
        data-theme="forge"
        data-typography
      >
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
