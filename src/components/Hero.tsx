import { useEffect, useState, SetStateAction } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";

export const Hero = () => {
  const { theme, systemTheme } = useTheme();

  const [currentTheme, setCurrentTheme] =
    useState<SetStateAction<string | undefined>>("");

  useEffect(() => {
    setCurrentTheme(theme === "system" ? systemTheme : theme);
  }, [theme, systemTheme]);

  const lightModeHeroImage = "/images/home/docs-hero-light.svg";
  const darkModeHeroImage = "/images/home/docs-hero-dark.svg";

  return (
    <div className="flex flex-col px-4 pt-8 mb-8 border-b-2 md:justify-around h-max md:flex-row">
      <div className="flex flex-col self-center w-auto flex-nowrap">
        <h2 className="mb-2 text-3xl font-semibold text-black font-satoshi dark:text-white md:w-48">
          Welcome to Clerk Docs
        </h2>
        <p className="mb-8 text-base text-gray-500 dark:text-[#545965] md:w-64">
          Find all the guides and resources you need to develop with Clerk.
        </p>
      </div>
      <div className="hidden md:h-60 md:pr-6 md:block">
        {currentTheme === "dark" && (
          <Image
            className="w-full h-auto md:max-w-lg sm:h-full sm:w-auto"
            src={darkModeHeroImage}
            width="600"
            height="288"
            alt="Hero Image"
            priority={true}
          />
        )}
        {currentTheme === "light" && (
          <Image
            className="w-full h-auto md:max-w-lg sm:h-full sm:w-auto"
            src={lightModeHeroImage}
            width="600"
            height="288"
            alt="Hero Image"
            priority={true}
          />
        )}
      </div>
      <div className="md:h-267.48"></div>
    </div>
  );
};
