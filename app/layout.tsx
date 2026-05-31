import type { ReactNode } from "react";

export const metadata = {
  title: "LINE Gemini FAQ Bot",
  description: "LINE webhook bot powered by Gemini 3.5 Flash",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
