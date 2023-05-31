import Image from "next/image";
import { useTheme } from "next-themes";
import { Figtree } from "next/font/google";

const figtree = Figtree({ subsets: ["latin"] });

export const Hero = () => {
  const { theme, systemTheme } = useTheme();

  const currentTheme = theme === "system" ? systemTheme : theme;

  const lightModeHeroImage = "/images/home/docs-hero-light.svg";
  const darkModeHeroImage = "/images/home/docs-hero-dark.svg";

  return (
    <div className="flex flex-col items-center justify-center px-4 pt-8 mb-8 border-b-2 md:flex-row md:items-end md:justify-around md:px-12 h-72 h-max">
      <div className="self-center w-64 sm:w-auto">
        <h2
          className={`${figtree.className} w-56 mb-2 text-3xl font-semibold sm:w-auto text-black dark:text-white`}
        >
          Welcome to Clerk Docs
        </h2>
        <p className="mb-8 text-base text-gray-500 dark:text-gray-300">
          Find all the guides and resources you need to develop with Clerk.
        </p>
      </div>
      <div className="md:h-60 md:pr-6">
        <Image
          className="w-full h-auto md:max-w-lg sm:h-full sm:w-auto"
          src={currentTheme === "dark" ? darkModeHeroImage : lightModeHeroImage}
          width="600"
          height="288"
          alt="Hero Image"
        />
      </div>
    </div>
  );
};
