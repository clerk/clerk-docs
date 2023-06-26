interface SubheaderProps {
  text: String;
}

export const Subheader = ({ text }: SubheaderProps) => (
  <h2 className="text-xl font-satoshi">{text}</h2>
);
