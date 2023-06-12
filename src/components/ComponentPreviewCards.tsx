import Link from "next/link";
import Image from "next/image";
import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"] });

interface ComponentPreviewCardsProps {
  title: string;
  link: string;
  cta: string;
  image: string;
  imageHeight: number;
  imageWidth: number;
}

export const ComponentPreviewCards = ({
  title,
  link,
  cta,
  image,
  imageHeight = 300,
  imageWidth = 300,
}: ComponentPreviewCardsProps) => (
  <div className="w-full h-auto py-8 mb-8 bg-white shadow-lg px-9 rounded-2xl dark:bg-gray-800 dark:border-gray-700 hover:cursor-pointer hover:shadow-2xl group">
    <Link href={link} className="h-full flex flex-col">
      <h5
        className={`${figtree.className} mb-2 text-[16px] font-semibold tracking-tight text-gray-900 dark:text-white`}
      >
        {title}
      </h5>
      <Image
        className="mb-5 w-full"
        src={image}
        alt={`${title} preview`}
        height={imageHeight}
        width={imageWidth}
        style={{ maxHeight: `${imageHeight}px`, maxWidth: `${imageWidth}px` }}
      />
      <div className="h-px grow"></div>
      <div className="inline-flex items-center mt-6 text-[13px] font-medium text-center text-gray-600 dark:text-gray-400 group-hover:text-clerk-purple">
        {cta}
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 ml-1 -mr-1 group-hover:animate-move-arrow"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
            clipRule="evenodd"
          ></path>
        </svg>
      </div>
    </Link>
  </div>
);
