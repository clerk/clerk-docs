import { useState } from "react";
import { RxCaretDown } from "react-icons/rx";
import {
  SiGatsby,
  SiJavascript,
  SiNextdotjs,
  SiReact,
  SiRemix,
  SiNodedotjs,
  SiRuby,
  SiGo,
  SiExpo,
  SiCurl

} from "react-icons/si";

export const CodeBlockTabs = ({
  options,
  children,
}: {
  options: Array<string>;
  children: Array<string>;
}) => {
  const [language, setLanguage] = useState("");
  const [codeBlock, setCodeblock] = useState(children[0]);
  const [showMenu, setShowMenu] = useState(false);

  type IconMapper = {
    [key: string]: JSX.Element;
  };

  const handleClick = ({
    option,
    index,
  }: {
    option: string;
    index: number;
  }) => {
    setLanguage(option);
    setCodeblock(children[index]);
  };

  const iconClass = "w-6 h-5 mr-2 -ml-1 mt-0.5";

  // This could be SVGs instead but I was lazy.
  const iconMap: IconMapper = {
    "Next.js": <SiNextdotjs className={iconClass} />,
    "Pages Router": <SiNextdotjs className={iconClass} />,
    "App Router": <SiNextdotjs className={iconClass} />,
    React: <SiReact className={iconClass} />,
    Remix: <SiRemix className={iconClass} />,
    Gatsby: <SiGatsby className={iconClass} />,
    JavaScript: <SiJavascript className={iconClass} />,
    Node: <SiNodedotjs className={iconClass} />,
    Ruby: <SiRuby className={iconClass} />,
    Go: <SiGo className={iconClass} />,
    Expo: <SiExpo className={iconClass} />,
    cURL: <SiCurl className={iconClass} />,
  };

  return (
    <div className="relative mt-4">
      <div className="absolute right-0 top-0 z-10 min-w-44">
        <button
          className="w-32 md:w-44 bg-white text-slate-500	 inline-flex right-0 top-0 p-2 z-10 rounded-md px-2 py-1 border border-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={() => setShowMenu(!showMenu)}
        >
          {iconMap[language || options[0]]} {language || options[0]}
          <RxCaretDown
            width="20px"
            height="20px"
            className="absolute right-0 mt-0.5 z-10"
          />
        </button>
        {showMenu && (
          <div className="absolute text-slate-500 w-32 md:w-44 right-0 top-10 z-10 rounded-md shadow-md ">
            {options.map((option, index) => (
              <button
                key={`lang-${index}`}
                className={`w-32 md:w-44 font-medium bg-white text-slate-500 px-5 py-2.5 text-center border border-gray-100 inline-flex items-center mr-2 mb-2'
                    }`}
                onClick={() => {
                  handleClick({ option, index });
                  setShowMenu(false);
                }}
              >
                {iconMap[option]}
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>{codeBlock}</div>
    </div>
  );
};
