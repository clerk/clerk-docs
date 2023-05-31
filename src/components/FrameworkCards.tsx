import Link from "next/link";
import Image from "next/image";
import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"] });

interface FrameworkCardsProps {
  title: string;
  description: string;
  link: string;
  cta: string;
  hideArrow?: boolean;
  icon: string;
  iconHeight: number;
  iconWidth: number;
}

export const FrameworkCards = ({
  title,
  description,
  link,
  cta,
  hideArrow,
  icon,
  iconHeight = 24,
  iconWidth = 24,
}: FrameworkCardsProps) => (
  <div className="py-8 mb-8 bg-white shadow-lg h-max px-9 w-72 rounded-2xl dark:bg-gray-800 dark:border-gray-700 hover:cursor-pointer hover:shadow-2xl group">
    <Link href={link}>
      {icon && (
        <Image
          className="mb-6"
          src={icon}
          alt={`${title} icon`}
          height={iconHeight}
          width={iconWidth}
        />
      )}
      <h5
        className={`${figtree.className} mb-2 text-md font-semibold tracking-tight text-gray-900 dark:text-white`}
      >
        {title}
      </h5>
      <p className="text-xs font-normal text-gray-500 dark:text-gray-400">
        {description}
      </p>
      <div className="inline-flex items-center mt-6 text-sm font-medium text-center text-gray-600 dark:text-gray-400 group-hover:text-violet-600">
        {cta}
        {!hideArrow && (
          <svg
            aria-hidden="true"
            className="w-4 h-4 ml-2 -mr-1 group-hover:animate-move-arrow"
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
        )}
      </div>
    </Link>
  </div>
);
