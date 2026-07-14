import type { Metadata } from "next";
import { Chakra_Petch, Outfit, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SoulSim",
  description: "可插拔灵魂的通用多 Agent 世界模拟引擎",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh"
      className={`${chakra.variable} ${outfit.variable} ${jetbrains.variable} h-full`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
      >
        <nav
          className="relative z-10 flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Link href="/" className="flex items-center gap-2.5 group">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
              style={{
                background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-violet))",
                color: "var(--bg-deep)",
                fontFamily: "var(--font-chakra)",
              }}
            >
              S
            </div>
            <span
              className="text-sm font-semibold tracking-wide"
              style={{ fontFamily: "var(--font-chakra)", color: "var(--text-primary)" }}
            >
              SOULSIM
            </span>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--text-muted)" }}
            >
              v0.1
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-xs transition-colors"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}
            >
              WORLDS
            </Link>
            <Link
              href="/admin"
              className="text-xs transition-colors"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-chakra)" }}
            >
              ADMIN
            </Link>
            <div id="nav-right-slot" className="flex items-center" />
          </div>
        </nav>
        <div className="relative z-1 flex-1">{children}</div>
      </body>
    </html>
  );
}
