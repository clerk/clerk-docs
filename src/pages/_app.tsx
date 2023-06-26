import type { AppProps } from "next/app";
import "../styles/globals.css";
import localFont from "next/font/local";
import { Inter } from "next/font/google";

const satoshi = localFont({
  src: [
    {
      path: "../../public/fonts/satoshi/Satoshi-Variable.ttf",
    },
  ],
  variable: "--font-satoshi",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <main className={`${inter.variable} ${satoshi.variable} font-inter`}>
      <Component {...pageProps} />
    </main>
  );
}
