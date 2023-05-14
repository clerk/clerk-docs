import type {DocsThemeConfig} from 'nextra-theme-docs';
import {useConfig} from 'nextra-theme-docs'
import {useRouter} from 'next/router'

const config: DocsThemeConfig = {

  useNextSeoProps() {
    const {asPath} = useRouter()
    if (asPath !== '/') {
      return {
        titleTemplate: '%s | Clerk'
      }
    }
    return {}
  },
  head: function useHead() {
    const {title} = useConfig()
    const {route} = useRouter()
    const socialCard =
      route === '/' || !title
        ? 'clerk-docs.clerkpreview.com/clerk-og.png'
        : `https://clerk-docs.clerkpreview.com/api/og?title=${encodeURIComponent(title)}`

    return (
      <>
        <meta name="msapplication-TileColor" content="#fff"/>
        <meta name="theme-color" content="#fff"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta httpEquiv="Content-Language" content="en"/>
        <meta
          name="description"
          content="Authentication and User management for the modern web"
        />
        <meta
          name="og:description"
          content="Authentication and User management for the modern web"
        />
        <meta name="twitter:card" content="summary_large_image"/>
        <meta name="twitter:image" content={socialCard}/>
        <meta name="twitter:site:domain" content="clerk.dev"/>
        <meta name="twitter:url" content="https://clerk.dev"/>
        <meta name="og:image" content={socialCard}/>
      </>
    )
  },
  logo: (
    <>
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M19.116 3.1608L16.2354 6.04135C16.1449 6.13177 16.0266 6.18918 15.8996 6.20437C15.7725 6.21956 15.6441 6.19165 15.5348 6.12513C14.4017 5.44155 13.0949 5.10063 11.7722 5.14354C10.4495 5.18645 9.16759 5.61134 8.08114 6.36692C7.41295 6.83202 6.83276 7.41221 6.36765 8.0804C5.61297 9.16751 5.18848 10.4495 5.14524 11.7722C5.10201 13.0949 5.44187 14.4019 6.12395 15.536C6.19 15.6451 6.21764 15.7731 6.20246 15.8998C6.18728 16.0264 6.13015 16.1443 6.04018 16.2347L3.15962 19.1152C3.10162 19.1736 3.03168 19.2188 2.95459 19.2476C2.87751 19.2765 2.79511 19.2883 2.71302 19.2824C2.63093 19.2764 2.5511 19.2528 2.479 19.2131C2.40689 19.1734 2.34422 19.1186 2.29527 19.0524C0.736704 16.9101 -0.0687588 14.3121 0.0046021 11.6639C0.077963 9.01568 1.02602 6.46625 2.70079 4.41354C3.21208 3.78549 3.78622 3.21134 4.41428 2.70006C6.46683 1.02574 9.01589 0.0779624 11.6637 0.00460332C14.3115 -0.0687557 16.9091 0.736432 19.0512 2.29453C19.1179 2.34332 19.1731 2.40598 19.2131 2.47818C19.2532 2.55038 19.2771 2.6304 19.2833 2.71274C19.2895 2.79508 19.2777 2.87778 19.2488 2.95513C19.2199 3.03248 19.1746 3.10265 19.116 3.1608Z"
          fill="url(#paint0_linear_26571_214331)"
        />
        <path
          d="M19.1135 20.8289L16.2329 17.9483C16.1424 17.8579 16.0241 17.8005 15.8971 17.7853C15.7701 17.7701 15.6416 17.798 15.5323 17.8645C14.4639 18.509 13.2398 18.8497 11.9921 18.8497C10.7443 18.8497 9.52022 18.509 8.45181 17.8645C8.34252 17.798 8.21406 17.7701 8.08701 17.7853C7.95997 17.8005 7.84171 17.8579 7.75119 17.9483L4.87063 20.8289C4.81022 20.8869 4.76333 20.9576 4.73329 21.0358C4.70324 21.114 4.69078 21.1979 4.69678 21.2815C4.70277 21.3651 4.72708 21.4463 4.76799 21.5194C4.80889 21.5926 4.86538 21.6558 4.93346 21.7046C6.98391 23.1965 9.45442 24.0001 11.9902 24.0001C14.5259 24.0001 16.9964 23.1965 19.0469 21.7046C19.1152 21.6561 19.172 21.5931 19.2133 21.5201C19.2545 21.4471 19.2792 21.366 19.2856 21.2824C19.2919 21.1988 19.2798 21.1148 19.2501 21.0365C19.2203 20.9581 19.1737 20.8872 19.1135 20.8289V20.8289Z"
          fill="currentColor"
        />
        <path
          d="M11.9973 15.4223C13.8899 15.4223 15.4243 13.888 15.4243 11.9953C15.4243 10.1027 13.8899 8.56836 11.9973 8.56836C10.1046 8.56836 8.57031 10.1027 8.57031 11.9953C8.57031 13.888 10.1046 15.4223 11.9973 15.4223Z"
          fill="currentColor"
        />
        <defs>
          <linearGradient
            id="paint0_linear_26571_214331"
            x1="16.4087"
            y1="-1.75881"
            x2="-7.88473"
            y2="22.5365"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#17CCFC"/>
            <stop offset="0.5" stopColor="#5D31FF"/>
            <stop offset="1" stopColor="#F35AFF"/>
          </linearGradient>
        </defs>
      </svg>

      <span
        style={{
          marginLeft: ".4em",
          marginTop: ".1em",
          fontWeight: 600,
          fontSize: "1.2em",
        }}
      >
        Docs
      </span>
    </>
  ),
  docsRepositoryBase: "https://github.com/clerkinc/clerk-docs/tree/main",
  navbar: {
    extraContent: () => {
      return <>
        <a href="https://discord.com/invite/b5rXHjAg7A" target="_blank" rel="noreferrer"
           className="nx-p-2 nx-text-current">
          <svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 127.14 96.36">
            <g id="图层_2" data-name="图层 2">
              <g id="Discord_Logos" data-name="Discord Logos">
                <g id="Discord_Logo_-_Large_-_White" data-name="Discord Logo - Large - White">
                  <path
                    d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
                </g>
              </g>
            </g>
          </svg>
          <span className="nx-sr-only">GitHub</span>
          <span className="nx-sr-only"> (opens in a new tab)</span>
        </a>
        <a href="https://twitter.com/clerkdev" target="_blank" rel="noreferrer"
           className="nx-p-2 nx-text-current">
          <svg height="24" width="24" version="1.1" id="Logo" xmlns="http://www.w3.org/2000/svg"
               x="0px" y="0px" viewBox="0 0 248 204">
            <g id="Logo_1_">
              <path id="white_background"
                    d="M221.95,51.29c0.15,2.17,0.15,4.34,0.15,6.53c0,66.73-50.8,143.69-143.69,143.69v-0.04   C50.97,201.51,24.1,193.65,1,178.83c3.99,0.48,8,0.72,12.02,0.73c22.74,0.02,44.83-7.61,62.72-21.66   c-21.61-0.41-40.56-14.5-47.18-35.07c7.57,1.46,15.37,1.16,22.8-0.87C27.8,117.2,10.85,96.5,10.85,72.46c0-0.22,0-0.43,0-0.64   c7.02,3.91,14.88,6.08,22.92,6.32C11.58,63.31,4.74,33.79,18.14,10.71c25.64,31.55,63.47,50.73,104.08,52.76   c-4.07-17.54,1.49-35.92,14.61-48.25c20.34-19.12,52.33-18.14,71.45,2.19c11.31-2.23,22.15-6.38,32.07-12.26   c-3.77,11.69-11.66,21.62-22.2,27.93c10.01-1.18,19.79-3.86,29-7.95C240.37,35.29,231.83,44.14,221.95,51.29z"/>
            </g>
          </svg>
          <span className="nx-sr-only">Twitter</span>
          <span className="nx-sr-only"> (opens in a new tab)</span>
        </a>
        <a href="https://github.com/clerkinc/clerk-docs/" target="_blank" rel="noreferrer"
           className="nx-p-2 nx-text-current">
          <svg width="24" height="24" fill="currentColor" viewBox="3 3 18 18"><title>GitHub</title>
            <path
              d="M12 3C7.0275 3 3 7.12937 3 12.2276C3 16.3109 5.57625 19.7597 9.15374 20.9824C9.60374 21.0631 9.77249 20.7863 9.77249 20.5441C9.77249 20.3249 9.76125 19.5982 9.76125 18.8254C7.5 19.2522 6.915 18.2602 6.735 17.7412C6.63375 17.4759 6.19499 16.6569 5.8125 16.4378C5.4975 16.2647 5.0475 15.838 5.80124 15.8264C6.51 15.8149 7.01625 16.4954 7.18499 16.7723C7.99499 18.1679 9.28875 17.7758 9.80625 17.5335C9.885 16.9337 10.1212 16.53 10.38 16.2993C8.3775 16.0687 6.285 15.2728 6.285 11.7432C6.285 10.7397 6.63375 9.9092 7.20749 9.26326C7.1175 9.03257 6.8025 8.08674 7.2975 6.81794C7.2975 6.81794 8.05125 6.57571 9.77249 7.76377C10.4925 7.55615 11.2575 7.45234 12.0225 7.45234C12.7875 7.45234 13.5525 7.55615 14.2725 7.76377C15.9937 6.56418 16.7475 6.81794 16.7475 6.81794C17.2424 8.08674 16.9275 9.03257 16.8375 9.26326C17.4113 9.9092 17.76 10.7281 17.76 11.7432C17.76 15.2843 15.6563 16.0687 13.6537 16.2993C13.98 16.5877 14.2613 17.1414 14.2613 18.0065C14.2613 19.2407 14.25 20.2326 14.25 20.5441C14.25 20.7863 14.4188 21.0746 14.8688 20.9824C16.6554 20.364 18.2079 19.1866 19.3078 17.6162C20.4077 16.0457 20.9995 14.1611 21 12.2276C21 7.12937 16.9725 3 12 3Z"></path>
          </svg>
          <span className="nx-sr-only">GitHub</span><span className="nx-sr-only"> (opens in a new tab)</span></a>
      </>
    }
  },
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
    titleComponent: ({title, type}) => {
      const isHeader = title.startsWith("#");
      if (isHeader) {
        const headerTitle = title.replace(/^#+\s*/, "");
        return (
          <div style={{fontSize: '1.2rem'}}>{headerTitle}</div>
        );
      }
      if (type === 'separator') {
        return (
          <hr/>
        );
      }
      return (
        <div>
          <RootIcon name={title}/>
          <span>{title}</span>
        </div>
      );
    },
  },
  navigation: false,
  footer: {
    text: (
      <span>
        {new Date().getFullYear()} ©{" "}
        <a href="https://clerk.dev" target="_blank" rel="noreferrer">
          Clerk
        </a>
        .
      </span>
    ),
  },
  feedback: {
    content: null
  },
  editLink: {
    text: `Found a mistake? Fix it on GitHub →`
  },
  banner: {
    key: 'beta-release',
    text: (
      <>
        <p>🎉 Welcome to the Clerk Docs Beta.</p>
        <a href="https://clerk.dev/docs" target="_blank" rel="noreferrer">
          Can&apos;t find what you are looking for? Go back to our stable docs →
        </a>
      </>
    )
  },
};


interface RootIconProps {
  name: string;
}

function RootIcon({name}: RootIconProps) {
  if (name === "Home") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path
          d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path>
      </svg>
    )
  }

  if (name === "Get Started") {
    return null;
  }

  if (name === "Quickstarts") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path fillRule="evenodd"
              d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
              clipRule="evenodd"></path>
      </svg>
    );
  }

  if (name === "Integrations") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path
          d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z"></path>
      </svg>
    )
  }

  if (name === "Users") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"></path>
      </svg>
    )
  }

  if (name === "Organizations") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path
          d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"></path>
      </svg>
    )
  }

  if (name === "Testing") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path fillRule="evenodd"
              d="M7 2a1 1 0 00-.707 1.707L7 4.414v3.758a1 1 0 01-.293.707l-4 4C.817 14.769 2.156 18 4.828 18h10.343c2.673 0 4.012-3.231 2.122-5.121l-4-4A1 1 0 0113 8.172V4.414l.707-.707A1 1 0 0013 2H7zm2 6.172V4h2v4.172a3 3 0 00.879 2.12l1.027 1.028a4 4 0 00-2.171.102l-.47.156a4 4 0 01-2.53 0l-.563-.187a1.993 1.993 0 00-.114-.035l1.063-1.063A3 3 0 009 8.172z"
              clipRule="evenodd"></path>
      </svg>
    )
  }

  if (name === "Advanced Usage") {
    return null;
  }

  if (name === "Migrations & Deployments") {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false"
           className="sidebar-icon">
        <path fillRule="evenodd" clipRule="evenodd"
              d="M15.8767 15.5158C19.8445 12.0469 22.8471 5.26536 21.0935 3.51175C19.3399 1.75814 12.5583 4.76075 9.08943 8.72856C6.8843 9.25328 2.4212 12.4164 3.06236 13.0576C3.38312 13.3784 5.11006 13.1972 7.03406 12.8721C6.93911 14.0457 7.32184 15.1959 8.36558 16.2397C9.40932 17.2834 10.5596 17.6661 11.7331 17.5712C11.4081 19.4952 11.2268 21.2222 11.5476 21.543C12.1887 22.1841 15.352 17.721 15.8767 15.5158ZM17.9115 8.10794C17.521 8.49844 16.8878 8.49844 16.4973 8.10794C16.1068 7.71745 16.1068 7.08423 16.4973 6.69373C16.8878 6.30323 17.521 6.30323 17.9115 6.69373C18.302 7.08423 18.302 7.71745 17.9115 8.10794Z"
              fill="currentColor"></path>
        <path
          d="M3.76938 20.8359C4.55038 21.6169 7.23094 20.2027 8.01202 19.4217C8.79311 18.6406 8.79302 17.3742 8.01202 16.5932C7.23103 15.8122 5.96468 15.8121 5.1836 16.5932C4.40252 17.3743 2.98839 20.0549 3.76938 20.8359Z"
          fill="currentColor"></path>
      </svg>
    )
  }

  if (name === "Security") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
           focusable="false" className="sidebar-icon">
        <path fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"></path>
      </svg>
    )
  }

  return null;
}

export default config;
