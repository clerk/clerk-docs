import Link from "next/link";
import Image from "next/image";

interface AuthProvidersCards {
  title: string;
  description: string;
  link: string;
  cta: string;
  hideArrow?: boolean;
  icon: string;
  iconHeight: number;
  iconWidth: number;
}

export const AuthProvidersCards = ({
  title,
  description,
  link,
  cta,
  hideArrow,
  icon,
  iconHeight = 24,
  iconWidth = 24,
}: AuthProvidersCards) => (
  <div className="w-full h-auto py-8 mb-8 bg-white shadow-lg px-9 rounded-2xl dark:bg-card-dark-grey dark:border-gray-700 hover:cursor-pointer hover:shadow-2xl group">
    <Link href={link}>
      {icon && (
        <Image
          className="mb-5"
          src={icon}
          alt={`${title} icon`}
          height={iconHeight}
          width={iconWidth}
        />
      )}
      <h5
        className={`font-satoshi mb-2 text-[16px] font-semibold tracking-tight text-gray-900 dark:text-white`}
      >
        {title}
      </h5>
      <p className="text-[13px] font-normal text-gray-500 dark:card-dark-text">
        {description}
      </p>
      <div className="inline-flex items-center mt-6 text-[13px] font-medium text-center text-gray-600 dark:card-dark-text group-hover:text-clerk-purple">
        {cta}
        {!hideArrow && (
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5 ml-1 -mr-1 ease-linear duration-100 group-hover:translate-x-1"
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
