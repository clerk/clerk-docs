import Image from "next/image"
import { useColorModeValue } from "@chakra-ui/react"

const lightLogo = '/images/clerk-logomark-light.svg';
const darkLogo = '/images/clerk-logomark-dark.svg';

export default {
    logo: 'Clerk Docs',
    useNextSeoProps() {
      return {
        titleTemplate: '%s – Clerk'
      }
    },
    docsRepositoryBase: 'https://github.com/clerkinc/clerk-docs/',
    project: {
      link: 'https://clerk.dev',
    },
    sidebar:{
      defaultMenuCollapseLevel: 1,
    },
    navigation: false,
    footer: {
      text: <span>
        {new Date().getFullYear()} © <a href="https://clerk.dev" target="_blank">Clerk</a>.
      </span>,
    }
  }