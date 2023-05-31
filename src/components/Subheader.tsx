import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"] });

interface SubheaderProps {
  text: String;
}

export const Subheader = ({ text }: SubheaderProps) => (
  <h2 className="text-xl font-figtree">{text}</h2>
);
